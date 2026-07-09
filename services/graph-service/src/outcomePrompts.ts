/**
 * Outcome prompts — the productized "did it work out?" follow-up queue.
 *
 * The inline 👍/👎 on a search result captures a hunch; the REAL signal comes
 * after someone actually visits/contacts a provider. So when a user acts on a
 * recommendation we drop a `pending` row here, and on a later visit we surface
 * "Did it work out with X?". Resolving it writes the authoritative outcome
 * (trust_outcomes) + updates the edge's rolling cache. Verified outcomes ranked
 * by YOUR network is the data moat Maps/Yelp can't structurally offer.
 *
 * Mirrors invites.ts / trustLog.ts; degrades to no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** How long after intent before we ask (default 0 = ask on next visit). */
const DELAY_MS = Number(process.env.OUTCOME_PROMPT_DELAY_MS ?? 0);

export function outcomePromptsEnabled(): boolean {
  return !!pool;
}

export async function initOutcomePrompts(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — outcome prompts disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS outcome_prompts (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      node_id     TEXT NOT NULL,
      edge_id     TEXT,
      topic       TEXT,
      geo         TEXT,
      label       TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending | worked | failed | dismissed
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS outcome_prompts_user_idx ON outcome_prompts(user_id, status, created_at)`,
  );
  // At most one pending prompt per (user, provider, topic) — never nag twice.
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS outcome_prompts_pending_uniq
       ON outcome_prompts(user_id, node_id, COALESCE(topic, ''))
       WHERE status = 'pending'`,
  );
  pool = p;
  console.log("graph-service: outcome prompts ready (postgres)");
}

export interface PromptInput {
  userId: string;
  nodeId: string;
  edgeId?: string;
  topic?: string;
  geo?: string;
  label?: string;
}

/** Record intent to use a provider → a pending follow-up (idempotent). */
export async function createPrompt(i: PromptInput): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO outcome_prompts (user_id, node_id, edge_id, topic, geo, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [i.userId, i.nodeId, i.edgeId ?? null, i.topic ?? null, i.geo ?? null, i.label ?? null],
    )
    .catch((e) => console.error("graph-service: createPrompt failed:", e instanceof Error ? e.message : e));
}

export interface PendingPrompt {
  id: string;
  nodeId: string;
  edgeId?: string;
  topic?: string;
  geo?: string;
  label?: string;
  createdAt: string;
}

/** Pending prompts that are now due to be asked (past the delay window). */
export async function pendingPrompts(userId: string): Promise<PendingPrompt[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, node_id, edge_id, topic, geo, label, created_at
       FROM outcome_prompts
      WHERE user_id = $1 AND status = 'pending'
        AND created_at <= now() - ($2::bigint || ' milliseconds')::interval
      ORDER BY created_at ASC
      LIMIT 20`,
    [userId, DELAY_MS],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    nodeId: row.node_id,
    edgeId: row.edge_id ?? undefined,
    topic: row.topic ?? undefined,
    geo: row.geo ?? undefined,
    label: row.label ?? undefined,
    createdAt: row.created_at,
  }));
}

export interface ResolvedPrompt {
  id: string;
  nodeId: string;
  edgeId?: string;
  topic?: string;
  geo?: string;
}

/**
 * Mark a prompt resolved (worked | failed | dismissed). Returns the row's key
 * fields so the caller can apply the outcome to the edge, or null if it wasn't
 * the user's pending prompt.
 */
export async function resolvePrompt(
  userId: string,
  id: string,
  status: "worked" | "failed" | "dismissed",
): Promise<ResolvedPrompt | null> {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE outcome_prompts
        SET status = $3, resolved_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'pending'
      RETURNING node_id, edge_id, topic, geo`,
    [id, userId, status],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id,
    nodeId: row.node_id,
    edgeId: row.edge_id ?? undefined,
    topic: row.topic ?? undefined,
    geo: row.geo ?? undefined,
  };
}
