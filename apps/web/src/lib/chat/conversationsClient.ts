/** BFF client for persistent agent conversations (agentic-ux Phase 2). */
import type { AgentMessage } from "@constellation/graph-core";
import type { AgentChatEntry } from "@/components/composer/AgentChat";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  transcript: AgentMessage[];
  turns: { role: "user" | "assistant"; content: string; trace: Record<string, unknown> | null }[];
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `request failed (${r.status})`);
  return (await r.json()) as T;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const r = await fetch("/api/conversations", { cache: "no-store" });
  return (await jsonOrThrow<{ conversations: ConversationSummary[] }>(r)).conversations;
}

export async function createConversation(title?: string): Promise<{ id: string }> {
  return jsonOrThrow(
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return jsonOrThrow(await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: "no-store" }));
}

/** Serialize display entries: text + everything the UI needs to rehydrate
 *  (trace, tool cards, decided confirms). Streaming flags never persist. */
export function serializeEntries(chat: AgentChatEntry[]) {
  return chat.map((e) => ({
    role: e.role,
    content: e.text,
    trace: {
      trace: e.trace,
      ...(e.trustData ? { trustData: e.trustData } : {}),
      ...(e.weaveData ? { weaveData: e.weaveData } : {}),
      ...(e.confirm ? { confirm: { ...e.confirm, decided: e.confirm.decided ?? "denied" } } : {}),
    },
  }));
}

export async function saveTurns(
  id: string,
  chat: AgentChatEntry[],
  transcript: AgentMessage[],
  titleIfUnset?: string,
): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/conversations/${encodeURIComponent(id)}/turns`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns: serializeEntries(chat), transcript, title: titleIfUnset }),
    }),
  );
}

export async function deleteConversation(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/** Rehydrate stored turns into display entries. */
export function entriesFromTurns(turns: ConversationDetail["turns"]): AgentChatEntry[] {
  return turns.map((t) => {
    const extra = (t.trace ?? {}) as {
      trace?: AgentChatEntry["trace"];
      trustData?: AgentChatEntry["trustData"];
      weaveData?: AgentChatEntry["weaveData"];
      confirm?: AgentChatEntry["confirm"];
    };
    return {
      role: t.role,
      text: t.content,
      trace: extra.trace ?? [],
      ...(extra.trustData ? { trustData: extra.trustData } : {}),
      ...(extra.weaveData ? { weaveData: extra.weaveData } : {}),
      ...(extra.confirm ? { confirm: extra.confirm } : {}),
    };
  });
}
