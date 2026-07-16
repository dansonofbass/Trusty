/**
 * The agent loop — model → tools → model, streamed as SSE events.
 *
 * Stateless across HTTP: the caller sends the full transcript each turn and
 * gets the canonical updated transcript back in the `done` event. Confirm-gated
 * tools suspend the loop (a `confirm` event ends the turn); the client resumes
 * by re-POSTing the transcript plus `{ resume: { toolCallId, approved, args? } }`.
 *
 * Multi-agent-ready: a tool with `kind: "agent"` may run a nested loop, using
 * `ctx.emit` with its own `agent`/`parentStepId` — the event protocol already
 * carries those fields, so nested traces need no changes here.
 */
import {
  pendingConfirm,
  trimTranscript,
  type AgentMessage,
  type AgentResume,
  type AgentStreamEvent,
  type AgentToolCall,
} from "@constellation/graph-core";
import type { GatewayCallMeta } from "../llmGateway";
import { agentChat, type ToolSpec } from "./gateway";

/** Everything a tool executor gets. `emit` lets slow tools (or sub-agents) stream progress. */
export interface ToolContext {
  userId: string;
  graphUrl: string;
  emit: (ev: AgentStreamEvent) => void;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  ok: boolean;
  /** What the model sees (kept compact — it goes into the transcript). */
  summary: string;
  /** Rich payload for the UI, forwarded on the tool_result event only. */
  data?: unknown;
}

export interface AgentTool {
  name: string;
  /** Prescriptive: say WHEN to call it, not just what it does. */
  description: string;
  inputSchema: Record<string, unknown>;
  /** Outward-facing tools pause for a user confirm card instead of executing. */
  confirm?: boolean;
  /** Confirm-card copy. */
  confirmTitle?: string;
  confirmDescription?: string;
  /** "agent" ⇒ execute runs a nested loop (future sub-agents). */
  kind?: "function" | "agent";
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolOutcome>;
}

export type ToolRegistry = Map<string, AgentTool>;

export interface RunAgentLoopOpts {
  transcript: AgentMessage[];
  system: string;
  registry: ToolRegistry;
  ctx: ToolContext;
  model: string;
  meta: GatewayCallMeta;
  emit: (ev: AgentStreamEvent) => void;
  agentName?: string;
  maxTurns?: number;
  resume?: AgentResume;
}

export interface AgentLoopResult {
  transcript: AgentMessage[];
  turns: number;
  /** True when the loop stopped on a confirm-gated tool call. */
  suspended: boolean;
}

const toSpecs = (registry: ToolRegistry): ToolSpec[] =>
  [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

export async function runAgentLoop(opts: RunAgentLoopOpts): Promise<AgentLoopResult> {
  const agent = opts.agentName ?? "composer";
  const maxTurns = opts.maxTurns ?? 8;
  const { registry, ctx, emit } = opts;
  const transcript = [...opts.transcript];
  let turns = 0;

  const runTool = async (tc: AgentToolCall, argsOverride?: unknown): Promise<void> => {
    const tool = registry.get(tc.name);
    const args = argsOverride ?? tc.args;
    emit({ type: "tool_call", id: tc.id, agent, tool: tc.name, args });
    let outcome: ToolOutcome;
    if (!tool) {
      outcome = { ok: false, summary: `unknown tool "${tc.name}"` };
    } else {
      try {
        outcome = await tool.execute(args, ctx);
      } catch (e) {
        outcome = { ok: false, summary: e instanceof Error ? e.message : String(e) };
      }
    }
    emit({
      type: "tool_result",
      id: tc.id,
      tool: tc.name,
      ok: outcome.ok,
      summary: outcome.summary,
      data: outcome.data,
    });
    transcript.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: outcome.summary });
  };

  /** Emit a confirm card for the first unanswered gated call, if any. */
  const suspendIfGatedPending = (): boolean => {
    const pending = pendingConfirm(transcript);
    if (!pending) return false;
    const tool = registry.get(pending.name);
    if (!tool?.confirm) return false; // shouldn't happen — gated tools are the only ones left unanswered
    emit({
      type: "confirm",
      id: pending.id,
      tool: pending.name,
      args: pending.args,
      title: tool.confirmTitle ?? `Run ${pending.name}?`,
      description: tool.confirmDescription ?? tool.description,
    });
    return true;
  };

  // Resume path: apply the user's decision to the suspended tool call, then
  // fall through to the normal loop (the model reacts to the result).
  if (opts.resume) {
    const pending = pendingConfirm(transcript);
    if (!pending || pending.id !== opts.resume.toolCallId) {
      throw new Error("resume does not match the pending tool call");
    }
    if (opts.resume.approved) {
      await runTool(pending, opts.resume.args);
    } else {
      const reason = opts.resume.reason ? `: ${opts.resume.reason}` : "";
      emit({
        type: "tool_result",
        id: pending.id,
        tool: pending.name,
        ok: false,
        summary: `user declined${reason}`,
      });
      transcript.push({
        role: "tool",
        toolCallId: pending.id,
        name: pending.name,
        content: `The user declined this action${reason}. Do not retry it unless they ask.`,
      });
    }
    // A batch can hold more than one gated call — surface the next one.
    if (suspendIfGatedPending()) return { transcript, turns, suspended: true };
  }

  while (turns < maxTurns) {
    turns++;
    const stepId = `${agent}_think_${turns}`;
    emit({ type: "step", id: stepId, agent, label: "Thinking", status: "active" });

    let result;
    try {
      result = await agentChat({
        model: opts.model,
        system: opts.system,
        messages: trimTranscript(transcript),
        tools: toSpecs(registry),
        meta: opts.meta,
        onToken: (t) => emit({ type: "token", content: t }),
      });
    } catch (e) {
      emit({
        type: "step",
        id: stepId,
        agent,
        label: "Thinking",
        status: "error",
        summary: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }

    transcript.push({
      role: "assistant",
      content: result.text,
      ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
    });
    emit({
      type: "step",
      id: stepId,
      agent,
      label: "Thinking",
      status: "done",
      summary: result.toolCalls.length
        ? result.toolCalls.map((tc) => tc.name).join(", ")
        : undefined,
    });

    if (!result.toolCalls.length) return { transcript, turns, suspended: false };

    // Execute ungated calls (concurrently), leave gated ones unanswered.
    const ungated = result.toolCalls.filter((tc) => !registry.get(tc.name)?.confirm);
    await Promise.all(ungated.map((tc) => runTool(tc)));

    if (suspendIfGatedPending()) return { transcript, turns, suspended: true };
  }

  emit({
    type: "step",
    id: `${agent}_limit`,
    agent,
    label: "Turn limit reached",
    status: "error",
    summary: `stopped after ${maxTurns} tool rounds`,
  });
  return { transcript, turns, suspended: false };
}
