/**
 * Saved answers — community memory. Any room member can pin a message as a
 * dated, attributed answer; the agent retrieves them later ("per Mahmoud,
 * May 2026: cash deposits are not acceptable…"). Deliberately community-shared
 * (not per-user writings), and space-scoped via the `app` column so one
 * community's knowledge never leaks into another's agent.
 *
 * Body + author are COPIED at save time so a later message delete doesn't eat
 * knowledge. Mirrors squads.ts; no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export interface AnswerRow {
  id: number;
  roomId: string;
  messageId: number;
  authorId: string;
  authorLabel: string;
  savedBy: string;
  body: string;
  topics: string[];
  app: string;
  createdAt: string;
}

export function answersEnabled(): boolean {
  return !!pool;
}

export async function initAnswers(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — saved answers disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS room_answers (
      id           BIGSERIAL PRIMARY KEY,
      room_id      TEXT NOT NULL,
      message_id   BIGINT NOT NULL UNIQUE,
      author_id    TEXT NOT NULL,
      author_label TEXT NOT NULL,
      saved_by     TEXT NOT NULL,
      body         TEXT NOT NULL,
      topics       TEXT[] NOT NULL DEFAULT '{}',
      app          TEXT NOT NULL DEFAULT 'general',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS room_answers_room_idx ON room_answers(room_id, id DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS room_answers_app_idx ON room_answers(app, id DESC)`);
  pool = p;
  console.log("graph-service: saved answers ready (postgres)");
}

const toRow = (row: Record<string, unknown>): AnswerRow => ({
  id: Number(row.id),
  roomId: String(row.room_id),
  messageId: Number(row.message_id),
  authorId: String(row.author_id),
  authorLabel: String(row.author_label),
  savedBy: String(row.saved_by),
  body: String(row.body),
  topics: Array.isArray(row.topics) ? (row.topics as string[]).map(String) : [],
  app: String(row.app),
  createdAt: new Date(row.created_at as string).toISOString(),
});

/** Pin a message as an answer (idempotent per message). */
export async function saveAnswer(a: {
  roomId: string;
  messageId: number;
  authorId: string;
  authorLabel: string;
  savedBy: string;
  body: string;
  topics: string[];
  app: string;
}): Promise<{ created: boolean }> {
  if (!pool) throw new Error("answers disabled");
  const r = await pool.query(
    `INSERT INTO room_answers (room_id, message_id, author_id, author_label, saved_by, body, topics, app)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (message_id) DO NOTHING`,
    [a.roomId, a.messageId, a.authorId, a.authorLabel, a.savedBy, a.body.slice(0, 4000), a.topics.slice(0, 8), a.app],
  );
  return { created: (r.rowCount ?? 0) > 0 };
}

/** A room's pinned answers, newest first. */
export async function listRoomAnswers(roomId: string, limit = 50): Promise<AnswerRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM room_answers WHERE room_id = $1 ORDER BY id DESC LIMIT $2`,
    [roomId, Math.min(limit, 100)],
  );
  return r.rows.map(toRow);
}

/** One answer by id — the basis of the public, shareable answer page. */
export async function getAnswer(id: number): Promise<AnswerRow | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM room_answers WHERE id = $1`, [id]);
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

/** Keyword search across a space's saved answers (body + topics), newest first. */
export async function searchAnswers(app: string, q: string, limit = 8): Promise<AnswerRow[]> {
  if (!pool) return [];
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length) return [];
  // Every term must hit body OR topics — simple, predictable, index-light.
  const clauses = terms.map((_, i) => `(lower(body) LIKE $${i + 2} OR EXISTS (SELECT 1 FROM unnest(topics) t WHERE lower(t) LIKE $${i + 2}))`);
  const r = await pool.query(
    `SELECT * FROM room_answers WHERE app = $1 AND ${clauses.join(" AND ")} ORDER BY id DESC LIMIT $${terms.length + 2}`,
    [app, ...terms.map((t) => `%${t}%`), Math.min(limit, 20)],
  );
  return r.rows.map(toRow);
}
