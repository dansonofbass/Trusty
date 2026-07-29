/**
 * Composer agent client (#29) — streams one agent turn over SSE via the BFF.
 *
 * Stateless protocol: send the stored transcript (+ new `text` or a confirm
 * `resume`), receive live events, and store the canonical transcript from the
 * `done` event for the next turn.
 */
import type {
  AgentMessage,
  AgentResume,
  AgentStreamEvent,
  ResolvedMention,
} from "@constellation/graph-core";

const AGENT_STREAM_URL = "/api/agent/stream";

/** The agent needs LiteLLM or an Anthropic key server-side — 503 means "use quick mode". */
export class AgentUnavailableError extends Error {
  constructor(message = "agent unavailable") {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export interface AgentTurnInput {
  transcript: AgentMessage[];
  /** New user message (omit when resuming a confirm decision). */
  text?: string;
  mentions?: ResolvedMention[];
  resume?: AgentResume;
  /** Stable conversation id for Langfuse session grouping. */
  sessionId?: string;
  skill?: string;
  /** The viewer's app-wide location scope (Armenia; default yerevan). */
  geo?: string;
}

export interface AgentTurnResult {
  transcript: AgentMessage[];
  turns: number;
  /** True when the turn ended on a confirm card (resume to continue). */
  suspended: boolean;
}

export async function streamAgentTurn(
  input: AgentTurnInput,
  onEvent: (ev: AgentStreamEvent) => void,
): Promise<AgentTurnResult> {
  const r = await fetch(AGENT_STREAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: input.transcript,
      ...(input.text ? { text: input.text } : {}),
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.skill ? { skill: input.skill } : {}),
      ...(input.geo ? { geo: input.geo } : {}),
    }),
  });
  if (r.status === 503) throw new AgentUnavailableError();
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `agent stream ${r.status}`);
  }
  if (!r.body) throw new Error("agent returned no stream body");

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: AgentTurnResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      let ev: AgentStreamEvent & { suspended?: boolean };
      try {
        ev = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      onEvent(ev);
      if (ev.type === "done") {
        result = {
          transcript: ev.transcript,
          turns: ev.turns,
          suspended: Boolean(ev.suspended),
        };
      }
      if (ev.type === "error") throw new Error(ev.message);
    }
  }

  if (!result) throw new Error("agent stream ended without result");
  return result;
}
