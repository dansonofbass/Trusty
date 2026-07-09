/**
 * Interaction log — durable, timestamped record of what users DO with recs and
 * nodes (a recommendation signal the graph alone doesn't retain).
 *
 * Structural mutations (accept/befriend/add-to-sky/trust) persist only as edges
 * with no history; dismissed is a flat id set. This append-only log gives the
 * blended recommender per-node/per-topic weighted counts with recency — the
 * basis for topic affinity, positive/negative reinforcement, and fatigue.
 * Mirrors trustLog.ts (gated, no-op fallback, boot-created).
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function interactionLogEnabled(): boolean {
  return !!pool;
}

export type InteractionKind =
  | "impression"
  | "click"
  | "accept"
  | "dismiss"
  | "befriend"
  | "add_to_sky"
  | "trust";

/** Default per-kind weights (aligned with the affinity coefficients). */
export const INTERACTION_WEIGHT: Record<InteractionKind, number> = {
  impression: 0.1,
  click: 0.5,
  accept: 1.5,
  dismiss: -1.0,
  befriend: 1.0,
  add_to_sky: 1.0,
  trust: 1.5,
};

export async function initInteractionLog(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — interaction log disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS interaction_events (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      node_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,   -- impression|click|accept|dismiss|befriend|add_to_sky|trust
      weight     REAL NOT NULL DEFAULT 1,
      topic      TEXT,
      community  INT,
      detail     JSONB,
      at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS interaction_events_user_idx ON interaction_events(user_id, at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS interaction_events_node_idx ON interaction_events(user_id, node_id)`);
  pool = p;
  console.log("graph-service: interaction log ready (postgres)");
}

export interface InteractionInput {
  userId: string;
  nodeId: string;
  kind: InteractionKind;
  weight?: number;
  topic?: string;
  community?: number;
  detail?: Record<string, unknown>;
}

/** Record one interaction — fire-and-forget. */
export async function recordInteraction(i: InteractionInput): Promise<void> {
  if (!pool) return;
  const weight = i.weight ?? INTERACTION_WEIGHT[i.kind] ?? 1;
  await pool
    .query(
      `INSERT INTO interaction_events (user_id, node_id, kind, weight, topic, community, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        i.userId,
        i.nodeId,
        i.kind,
        weight,
        i.topic ?? null,
        i.community ?? null,
        i.detail ? JSON.stringify(i.detail) : null,
      ],
    )
    .catch((e) => console.error("graph-service: recordInteraction failed:", e instanceof Error ? e.message : e));
}

/** Record a batch of interactions (browser impressions/clicks). Best-effort. */
export async function recordInteractions(items: InteractionInput[]): Promise<void> {
  if (!pool || items.length === 0) return;
  const values: unknown[] = [];
  const rows = items.slice(0, 200).map((i, n) => {
    const b = n * 7;
    values.push(
      i.userId,
      i.nodeId,
      i.kind,
      i.weight ?? INTERACTION_WEIGHT[i.kind] ?? 1,
      i.topic ?? null,
      i.community ?? null,
      i.detail ? JSON.stringify(i.detail) : null,
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
  });
  await pool
    .query(
      `INSERT INTO interaction_events (user_id, node_id, kind, weight, topic, community, detail)
       VALUES ${rows.join(", ")}`,
      values,
    )
    .catch((e) => console.error("graph-service: recordInteractions failed:", e instanceof Error ? e.message : e));
}
