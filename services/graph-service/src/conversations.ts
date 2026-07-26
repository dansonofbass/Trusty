/**
 * Persistent agent conversations (agentic-ux Phase 2).
 *
 * Two representations, stored together because they serve different masters:
 * - `conversation_turns` — the DISPLAY transcript (user/assistant entries with
 *   trace/tool cards) the ChatView rehydrates from.
 * - `conversations.transcript` — the RAW AgentMessage[] the stateless agent
 *   loop needs back verbatim to continue the thread (tool calls included).
 *
 * Turns are replaced wholesale per completed turn (conversations are short;
 * correctness over cleverness — resume/confirm flows rewrite the tail).
 * Mirrors journeys.ts; no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function conversationsEnabled(): boolean {
  return !!pool;
}

export async function initConversations(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — conversations disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT,                          -- null until auto-titled
      transcript  JSONB NOT NULL DEFAULT '[]',   -- raw AgentMessage[] for loop resume
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id, updated_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      id              BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,             -- user | assistant
      content         TEXT NOT NULL DEFAULT '',
      trace           JSONB,                     -- display extras (trace, trustData, weaveData, confirm)
      at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS conversation_turns_idx ON conversation_turns(conversation_id, id)`);
  pool = p;
  console.log("graph-service: conversations ready (postgres)");
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  trace: Record<string, unknown> | null;
}

export interface ConversationDetail extends ConversationSummary {
  createdAt: string;
  transcript: unknown[];
  turns: ConversationTurn[];
}

export async function listConversations(userId: string, limit = 50): Promise<ConversationSummary[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, title, updated_at FROM conversations
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    title: row.title ?? "New conversation",
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function createConversation(userId: string, title?: string): Promise<{ id: string }> {
  if (!pool) throw new Error("conversations disabled");
  const r = await pool.query(
    `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
    [userId, title?.trim() || null],
  );
  return { id: String(r.rows[0].id) };
}

export async function getConversation(userId: string, id: string): Promise<ConversationDetail | null> {
  if (!pool) return null;
  const r = await pool.query(
    `SELECT id, title, transcript, created_at, updated_at FROM conversations
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!r.rowCount) return null;
  const turns = await pool.query(
    `SELECT role, content, trace FROM conversation_turns WHERE conversation_id = $1 ORDER BY id`,
    [id],
  );
  const row = r.rows[0];
  return {
    id: String(row.id),
    title: row.title ?? "New conversation",
    transcript: (row.transcript ?? []) as unknown[],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    turns: turns.rows.map((t) => ({
      role: t.role === "user" ? "user" : "assistant",
      content: String(t.content ?? ""),
      trace: (t.trace ?? null) as Record<string, unknown> | null,
    })),
  };
}

/** Replace the display turns + raw transcript after a completed agent turn.
 *  Sets the title on first save (never overwrites a user rename). */
export async function replaceTurns(
  userId: string,
  id: string,
  turns: ConversationTurn[],
  transcript: unknown[],
  titleIfUnset?: string,
): Promise<boolean> {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const own = await client.query(
      `SELECT title FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId],
    );
    if (!own.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`DELETE FROM conversation_turns WHERE conversation_id = $1`, [id]);
    for (const t of turns) {
      await client.query(
        `INSERT INTO conversation_turns (conversation_id, role, content, trace) VALUES ($1, $2, $3, $4)`,
        [id, t.role, t.content ?? "", t.trace ? JSON.stringify(t.trace) : null],
      );
    }
    const title = own.rows[0].title ?? (titleIfUnset?.trim() || null);
    await client.query(
      `UPDATE conversations SET transcript = $2, title = $3, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(transcript ?? []), title],
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function renameConversation(userId: string, id: string, title: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE conversations SET title = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, userId, title.trim().slice(0, 120) || "New conversation"],
  );
  return !!r.rowCount;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(`DELETE FROM conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
  return !!r.rowCount;
}
