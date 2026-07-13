/**
 * Reputation service — topic-scoped, DERIVED provider reputation over the
 * append-only `trust_outcomes` log. The math (shrinkage / decay / consensus)
 * lives in graph-core `aggregateReputation` so it's pure + tested; this module
 * only does the SQL + topic-hierarchy rollup.
 *
 * Reputation is recomputed on read (never a stored authoritative score, #11), so
 * it's always reproducible from evidence. Degrades to a no-op without
 * DATABASE_URL (callers treat providers as un-reputed / neutral).
 */
import pg from "pg";
import {
  aggregateReputation,
  normalizeTopic,
  TOPIC_PARENT,
  type ReputationSample,
  type ReputationScore,
  type ReputationOptions,
} from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** Config — all tunable, none hardcoded in ranking logic (#10 dev note). */
const OPTS: Omit<ReputationOptions, "now"> = {
  halfLifeDays: Number(process.env.REPUTATION_HALF_LIFE_DAYS ?? 180) || 180,
  priorStrength: Number(process.env.REPUTATION_PRIOR_STRENGTH ?? 3) || 3,
  prior: 0,
  consensusK: Number(process.env.REPUTATION_CONSENSUS_K ?? 2) || 2,
};

export function reputationEnabled(): boolean {
  return !!pool;
}

export async function initReputation(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — reputation disabled");
    return;
  }
  // Reuses the existing trust_outcomes table (trustLog.ts owns its DDL); we only
  // need a read pool + an index that helps the per-topic aggregation.
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p
    .query(`CREATE INDEX IF NOT EXISTS trust_outcomes_to_idx ON trust_outcomes(to_id)`)
    .catch(() => undefined);
  pool = p;
  console.log("graph-service: reputation ready (postgres, derived)");
}

/** Topics whose outcomes count toward `topic`: itself + its direct children. */
function topicMatchSet(topic: string): Set<string> {
  const t = normalizeTopic(topic);
  const set = new Set<string>([t]);
  for (const [child, parent] of Object.entries(TOPIC_PARENT)) {
    if (parent === t) set.add(child);
  }
  return set;
}

interface OutcomeRow {
  to_id: string;
  topic: string | null;
  value: number | null;
  user_id: string;
  at_ms: string;
}

function toSample(r: OutcomeRow): ReputationSample {
  return { value: Number(r.value ?? 0), contributorId: r.user_id, atMs: Number(r.at_ms) };
}

/** Reputation of one provider on one topic (with child-topic rollup). */
export async function reputationFor(providerId: string, topic: string): Promise<ReputationScore | null> {
  if (!pool || !topic) return null;
  const topics = [...topicMatchSet(topic)];
  const r = await pool.query<OutcomeRow>(
    `SELECT to_id, scope->>'topic' AS topic, value, user_id,
            extract(epoch from at)*1000 AS at_ms
       FROM trust_outcomes
      WHERE to_id = $1 AND value IS NOT NULL AND scope->>'topic' = ANY($2)`,
    [providerId, topics],
  );
  if (r.rows.length === 0) return null;
  return aggregateReputation(r.rows.map(toSample), { now: Date.now(), ...OPTS });
}

/** Reputation of every provider that has outcomes on `topic` (blend + facets). */
export async function reputationIndex(topic: string): Promise<Map<string, ReputationScore>> {
  const out = new Map<string, ReputationScore>();
  if (!pool || !topic) return out;
  const topics = [...topicMatchSet(topic)];
  const r = await pool.query<OutcomeRow>(
    `SELECT to_id, scope->>'topic' AS topic, value, user_id,
            extract(epoch from at)*1000 AS at_ms
       FROM trust_outcomes
      WHERE to_id IS NOT NULL AND value IS NOT NULL AND scope->>'topic' = ANY($1)`,
    [topics],
  );
  const byProvider = new Map<string, ReputationSample[]>();
  for (const row of r.rows) {
    const list = byProvider.get(row.to_id) ?? [];
    list.push(toSample(row));
    byProvider.set(row.to_id, list);
  }
  const now = Date.now();
  for (const [providerId, samples] of byProvider) {
    out.set(providerId, aggregateReputation(samples, { now, ...OPTS }));
  }
  return out;
}
