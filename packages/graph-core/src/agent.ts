/**
 * Composer agent protocol (#29) — the shared vocabulary between the extractor's
 * tool-calling loop and the web client.
 *
 * The transcript wire format is deliberately provider-neutral: the extractor
 * maps it to OpenAI (LiteLLM) or Anthropic shapes per request, and the client
 * only ever stores/resends what the server returned in `done.transcript`. The
 * loop itself is stateless across HTTP — a confirm-gated tool call ends the
 * turn, and the client resumes by re-POSTing the transcript plus the user's
 * decision.
 */

/** A tool invocation the model requested. */
export interface AgentToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** One transcript entry. `tool` carries the result the model saw. */
export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** A mention the composer resolved client-side (@person, #topic, [[entity]]).
 *  The model receives ids/canonical topics — never re-guesses from text. */
export interface ResolvedMention {
  /** The literal token as it appears in the text, e.g. "@Maria K.". */
  token: string;
  /** Graph node id (for @people and [[entities]]). */
  id?: string;
  /** Node type (person, location, …) when id is set. */
  type?: string;
  label?: string;
  /** Canonical taxonomy topic (for #topic mentions). */
  topic?: string;
}

/** SSE events streamed by POST /agent/stream. Step-ish events carry `agent`
 *  (default "composer") + optional `parentStepId` so a future sub-agent's
 *  nested trace renders without protocol changes. */
export type AgentStreamEvent =
  | {
      type: "step";
      id: string;
      agent: string;
      parentStepId?: string;
      label: string;
      status: "active" | "done" | "error";
      summary?: string;
    }
  | { type: "tool_call"; id: string; agent: string; parentStepId?: string; tool: string; args: unknown }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      ok: boolean;
      /** What the model saw (compact). */
      summary: string;
      /** Rich payload for the UI (e.g. trust recommendations). */
      data?: unknown;
    }
  | { type: "token"; content: string }
  | {
      /** A gated tool call — the turn ends; the client renders a confirm card
       *  and resumes with `{ resume: { toolCallId, approved, args? } }`. */
      type: "confirm";
      id: string;
      tool: string;
      args: unknown;
      title: string;
      description: string;
    }
  | { type: "clarify"; question: string }
  | { type: "done"; transcript: AgentMessage[]; variant: string; turns: number }
  | { type: "error"; message: string };

/** The client's resume payload after a confirm card decision. */
export interface AgentResume {
  toolCallId: string;
  approved: boolean;
  /** User-edited args (confirm cards let the user fix topic/note before approving). */
  args?: unknown;
  /** Optional reason on deny — fed back to the model so it can adapt. */
  reason?: string;
}

/** The gated tool call awaiting a user decision: the first tool call in the
 *  final assistant message that has no tool result after it. Null when the
 *  transcript isn't suspended on a confirm. */
export function pendingConfirm(transcript: AgentMessage[]): AgentToolCall | null {
  let lastAssistant = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant < 0) return null;
  const msg = transcript[lastAssistant];
  if (msg.role !== "assistant" || !msg.toolCalls?.length) return null;
  const answered = new Set(
    transcript
      .slice(lastAssistant + 1)
      .filter((m): m is Extract<AgentMessage, { role: "tool" }> => m.role === "tool")
      .map((m) => m.toolCallId),
  );
  return msg.toolCalls.find((tc) => !answered.has(tc.id)) ?? null;
}

/** Trim a transcript to a character budget, dropping oldest messages first but
 *  never splitting an assistant-toolCalls / tool-results group (a dangling tool
 *  result without its call is invalid in both provider formats). */
export function trimTranscript(transcript: AgentMessage[], maxChars = 60_000): AgentMessage[] {
  const size = (m: AgentMessage) =>
    (m.role === "assistant" ? JSON.stringify(m.toolCalls ?? "") : "").length + m.content.length + 24;
  let total = transcript.reduce((s, m) => s + size(m), 0);
  let start = 0;
  while (start < transcript.length - 1 && total > maxChars) {
    total -= size(transcript[start]);
    start++;
    // Never start on a tool result — walk forward to the next user/assistant turn.
    while (start < transcript.length - 1 && transcript[start].role === "tool") {
      total -= size(transcript[start]);
      start++;
    }
  }
  return start === 0 ? transcript : transcript.slice(start);
}
