/**
 * In-app feedback (summit demo → keeper): one button, straight to the admin
 * inbox. Append-only; mirrors asks.ts. No-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function feedbackEnabled(): boolean {
  return !!pool;
}

export async function initFeedback(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — feedback disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      text        TEXT NOT NULL,
      screen      TEXT,
      app         TEXT NOT NULL DEFAULT 'general',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  pool = p;
  console.log("graph-service: feedback ready (postgres)");
}

export async function addFeedback(userId: string, text: string, screen?: string, app?: string): Promise<boolean> {
  if (!pool) return false;
  const clean = text.trim().slice(0, 2000);
  if (!clean) return false;
  await pool.query(
    `INSERT INTO feedback (user_id, text, screen, app) VALUES ($1, $2, $3, $4)`,
    [userId, clean, screen?.slice(0, 120) ?? null, app?.slice(0, 40) ?? "general"],
  );
  return true;
}

export interface FeedbackRow {
  id: string;
  userId: string;
  text: string;
  screen: string | null;
  app: string;
  createdAt: string;
}

export async function listFeedback(limit = 200): Promise<FeedbackRow[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM feedback ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    text: String(row.text),
    screen: row.screen ?? null,
    app: String(row.app),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
