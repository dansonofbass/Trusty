/**
 * Trust outcomes log — durable, append-only record of recommendation feedback.
 *
 * The trust edge in Neo4j keeps a rolling `outcome` *cache*; this table is the
 * authoritative history (who judged which recommendation, when, on what scope).
 * Mirrors the writings/writing_events pattern; degrades to a no-op without
 * DATABASE_URL.
 */
import pg from "pg";
import type { TrustScope } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function trustLogEnabled(): boolean {
  return !!pool;
}

export async function initTrustLog(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — trust outcomes log disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS trust_outcomes (
      id          BIGSERIAL PRIMARY KEY,
      edge_id     TEXT NOT NULL,
      from_id     TEXT NOT NULL,
      to_id       TEXT,
      user_id     TEXT NOT NULL,
      rec_node_id TEXT,
      kind        TEXT NOT NULL,
      value       REAL,
      scope       JSONB,
      detail      JSONB,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS trust_outcomes_edge_idx ON trust_outcomes(edge_id, at)`);
  await p.query(`CREATE INDEX IF NOT EXISTS trust_outcomes_pair_idx ON trust_outcomes(from_id, to_id)`);
  pool = p;
  console.log("graph-service: trust outcomes log ready (postgres)");
}

export interface OutcomeInput {
  edgeId: string;
  fromId: string;
  toId?: string;
  userId: string;
  recNodeId?: string;
  /** "positive" | "negative" | … */
  kind: string;
  /** Normalized signal in [-1,1]. */
  value: number;
  scope?: TrustScope;
}

/** Aggregate outcomes recorded against a provider node (for its detail panel). */
export async function outcomeStats(nodeId: string): Promise<{ positive: number; negative: number; total: number }> {
  if (!pool) return { positive: 0, negative: 0, total: 0 };
  try {
    const r = await pool.query(
      `SELECT count(*) FILTER (WHERE value > 0) AS pos,
              count(*) FILTER (WHERE value < 0) AS neg,
              count(*) AS total
         FROM trust_outcomes WHERE to_id = $1`,
      [nodeId],
    );
    return {
      positive: Number(r.rows[0]?.pos ?? 0),
      negative: Number(r.rows[0]?.neg ?? 0),
      total: Number(r.rows[0]?.total ?? 0),
    };
  } catch {
    return { positive: 0, negative: 0, total: 0 };
  }
}

export async function recordOutcome(i: OutcomeInput): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO trust_outcomes (edge_id, from_id, to_id, user_id, rec_node_id, kind, value, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        i.edgeId,
        i.fromId,
        i.toId ?? null,
        i.userId,
        i.recNodeId ?? null,
        i.kind,
        i.value,
        i.scope ? JSON.stringify(i.scope) : null,
      ],
    )
    .catch((e) => console.error("graph-service: recordOutcome failed:", e instanceof Error ? e.message : e));
}
