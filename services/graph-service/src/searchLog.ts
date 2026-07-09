/**
 * Search log — durable history of what users search for (recommendation signal).
 *
 * Trust-search and resolve-scope are otherwise stateless; capturing the resolved
 * topic (+ geo/result-count) per user over time is the raw material for the
 * per-user topic-affinity profile the blended recommender reads. Mirrors
 * trustLog.ts: DATABASE_URL-gated, no-op fallback, tables self-created on boot.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function searchLogEnabled(): boolean {
  return !!pool;
}

export async function initSearchLog(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — search log disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS search_events (
      id           BIGSERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      raw_query    TEXT,
      topic        TEXT,
      geo          TEXT,
      context      TEXT,
      expanded     JSONB,
      result_count INT NOT NULL DEFAULT 0,
      source       TEXT NOT NULL,          -- trust-search | resolve-scope
      at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS search_events_user_idx ON search_events(user_id, at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS search_events_topic_idx ON search_events(topic, at DESC)`);
  pool = p;
  console.log("graph-service: search log ready (postgres)");
}

export interface SearchEvent {
  userId: string;
  rawQuery?: string;
  topic?: string;
  geo?: string;
  context?: string;
  expanded?: string[];
  resultCount?: number;
  source: "trust-search" | "resolve-scope";
}

/** Record a search — fire-and-forget, never blocks the response. */
export async function recordSearch(i: SearchEvent): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO search_events (user_id, raw_query, topic, geo, context, expanded, result_count, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        i.userId,
        i.rawQuery ?? null,
        i.topic ?? null,
        i.geo ?? null,
        i.context ?? null,
        i.expanded ? JSON.stringify(i.expanded) : null,
        i.resultCount ?? 0,
        i.source,
      ],
    )
    .catch((e) => console.error("graph-service: recordSearch failed:", e instanceof Error ? e.message : e));
}
