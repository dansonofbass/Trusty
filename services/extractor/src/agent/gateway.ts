/**
 * Agent gateway — one LLM turn with tool schemas attached.
 *
 * Unlike `gatewayChat` (single-turn system+user → string), this speaks the full
 * transcript + tools protocol the agent loop needs. Two provider paths, mirroring
 * the rest of the extractor:
 *
 *   • LiteLLM (primary when LITELLM_BASE_URL is set) — OpenAI-format messages[]
 *     + tools[], streamed; tool-call fragments are accumulated by index. Keeps
 *     Langfuse cost/trace accounting.
 *   • Direct Anthropic SDK (fallback when only ANTHROPIC_API_KEY is set) —
 *     messages.stream with native tool_use blocks.
 *
 * The transcript arrives in the neutral AgentMessage shape (graph-core) and is
 * mapped per provider here, so the loop and registry stay provider-agnostic.
 */
import { reportUsage } from "../models";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, AgentToolCall } from "@constellation/graph-core";
import { litellmConfigured, type GatewayCallMeta } from "../llmGateway";

const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL?.replace(/\/+$/, "");
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? "";
const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

/** True when at least one provider can run the agent loop. */
export const agentConfigured = (): boolean => litellmConfigured() || Boolean(anthropic);

/** A tool as the model sees it (JSON Schema input). */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentChatOpts {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  meta: GatewayCallMeta;
  onToken?: (token: string) => void;
}

/** One model turn: streamed text plus any tool calls it requested. */
export interface AgentChatResult {
  text: string;
  toolCalls: AgentToolCall[];
}

export async function agentChat(opts: AgentChatOpts): Promise<AgentChatResult> {
  if (litellmConfigured()) return litellmAgentChat(opts);
  if (anthropic) return anthropicAgentChat(opts);
  throw new Error("agent unavailable: neither LiteLLM nor ANTHROPIC_API_KEY configured");
}

/* ------------------------------ LiteLLM ------------------------------ */

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAiMessages(system: string, messages: AgentMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
              })),
            }
          : {}),
      });
    else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

async function litellmAgentChat(opts: AgentChatOpts): Promise<AgentChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAiMessages(opts.system, opts.messages),
    ...(opts.tools.length
      ? {
          tools: opts.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
          tool_choice: "auto",
        }
      : {}),
    metadata: {
      generation_name: `agent:${opts.meta.endpoint}`,
      trace_name: `agent:${opts.meta.endpoint}`,
      trace_user_id: opts.meta.userId || "anonymous",
      ...(opts.meta.sessionId ? { session_id: opts.meta.sessionId } : {}),
      tags: [
        `variant:${opts.meta.variant}`,
        `source:${opts.meta.source}`,
        `provider:${opts.meta.provider}`,
      ],
      trace_metadata: {
        variant: opts.meta.variant,
        variantSource: opts.meta.source,
        provider: opts.meta.provider,
        endpoint: opts.meta.endpoint,
      },
    },
  };

  const r = await fetch(`${LITELLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${LITELLM_MASTER_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`litellm responded ${r.status}: ${await r.text().catch(() => "")}`);
  }
  const reader = r.body?.getReader();
  if (!reader) throw new Error("litellm returned no stream body");

  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  // Tool-call fragments arrive keyed by index; id/name land on the first
  // fragment, argument text is concatenated across the rest.
  const frags = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        // Final chunk carries real token counts — the basis for cost insights.
        if (chunk.usage) {
          reportUsage({
            userId: opts.meta.userId,
            model: opts.model,
            provider: opts.meta.provider,
            endpoint: opts.meta.endpoint,
            promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
            completionTokens: Number(chunk.usage.completion_tokens ?? 0),
            tier: opts.meta.tier,
          });
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          opts.onToken?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = frags.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          frags.set(idx, cur);
        }
      } catch {
        /* ignore partial lines */
      }
    }
  }

  const toolCalls: AgentToolCall[] = [...frags.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, f]) => ({
      id: f.id || `call_${i}`,
      name: f.name,
      args: safeJson(f.args),
    }))
    .filter((tc) => tc.name);
  return { text, toolCalls };
}

function safeJson(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/* ------------------------- Anthropic (direct) ------------------------ */

type AnthropicMessage = Anthropic.MessageParam;

function toAnthropicMessages(messages: AgentMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? [])
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
      if (content.length) out.push({ role: "assistant", content });
    } else {
      // Consecutive tool results must batch into ONE user message.
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const prev = out[out.length - 1];
      if (
        prev?.role === "user" &&
        Array.isArray(prev.content) &&
        prev.content.every((b) => b.type === "tool_result")
      ) {
        (prev.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

async function anthropicAgentChat(opts: AgentChatOpts): Promise<AgentChatResult> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not configured");
  const stream = anthropic.messages.stream({
    model: opts.model,
    max_tokens: 2048,
    system: opts.system,
    messages: toAnthropicMessages(opts.messages),
    ...(opts.tools.length
      ? {
          tools: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
          })),
        }
      : {}),
  });
  stream.on("text", (t) => opts.onToken?.(t));
  const final = await stream.finalMessage();
  let text = "";
  const toolCalls: AgentToolCall[] = [];
  for (const block of final.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use")
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
  }
  return { text, toolCalls };
}
