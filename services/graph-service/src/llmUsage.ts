/**
 * LLM usage + plan tiers.
 *
 * Two small concerns that belong together operationally: what each model
 * actually costs us, and which model a given user is entitled to.
 *
 * • `llm_usage` — one row per model call (tokens + USD, from LiteLLM's own
 *   price table via the extractor). Aggregates power the admin cost panel
 *   without depending on Elasticsearch or the Langfuse API being up.
 * • `user_plans` — a user's tier (free / premium / …). The extractor maps a
 *   tier to a model, so "premium users get the strong model" is admin config,
 *   not code. Absent row = the default tier.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export const DEFAULT_TIER = "free";
/** Known tiers, ordered cheapest → richest. Extend freely; admin UI reads this. */
export const TIERS = ["free", "premium"] as const;

export function usageEnabled(): boolean {
  return !!pool;
}

export async function initLlmUsage(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — LLM usage + plan tiers disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id                BIGSERIAL PRIMARY KEY,
      user_id           TEXT,
      model             TEXT NOT NULL,
      provider          TEXT,
      endpoint          TEXT,
      tier              TEXT,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd          DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS llm_usage_time_idx ON llm_usage(created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS llm_usage_model_idx ON llm_usage(model, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS llm_usage_user_idx ON llm_usage(user_id, created_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_plans (
      user_id    TEXT PRIMARY KEY,
      tier       TEXT NOT NULL,
      note       TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  pool = p;
  console.log("graph-service: llm usage + plan tiers ready (postgres)");
}

/* ------------------------------- usage ------------------------------- */

export interface UsageRow {
  userId?: string;
  model: string;
  provider?: string;
  endpoint?: string;
  tier?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export async function recordUsage(u: UsageRow): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO llm_usage (user_id, model, provider, endpoint, tier, prompt_tokens, completion_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      u.userId?.slice(0, 200) ?? null,
      u.model.slice(0, 120),
      u.provider?.slice(0, 40) ?? null,
      u.endpoint?.slice(0, 60) ?? null,
      u.tier?.slice(0, 30) ?? null,
      Math.max(0, Math.round(u.promptTokens)),
      Math.max(0, Math.round(u.completionTokens)),
      Math.max(0, u.costUsd),
    ],
  );
}

export interface UsageSummary {
  windowDays: number;
  totals: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
  byModel: { model: string; calls: number; tokens: number; costUsd: number }[];
  byDay: { day: string; calls: number; costUsd: number }[];
  byEndpoint: { endpoint: string; calls: number; costUsd: number }[];
  topUsers: { userId: string; label?: string; calls: number; costUsd: number }[];
}

/** Everything the admin cost panel needs, in one round-trip. */
export async function usageSummary(days = 30): Promise<UsageSummary> {
  const empty: UsageSummary = {
    windowDays: days,
    totals: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    byModel: [],
    byDay: [],
    byEndpoint: [],
    topUsers: [],
  };
  if (!pool) return empty;
  const win = `now() - ($1 || ' days')::interval`;
  const d = String(Math.max(1, Math.min(365, Math.floor(days))));

  const [totals, byModel, byDay, byEndpoint, topUsers] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS calls, COALESCE(SUM(prompt_tokens),0)::bigint AS pt,
              COALESCE(SUM(completion_tokens),0)::bigint AS ct, COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at > ${win}`,
      [d],
    ),
    pool.query(
      `SELECT model, count(*)::int AS calls,
              COALESCE(SUM(prompt_tokens + completion_tokens),0)::bigint AS tokens,
              COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at > ${win}
        GROUP BY model ORDER BY cost DESC`,
      [d],
    ),
    pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              count(*)::int AS calls, COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at > ${win}
        GROUP BY 1 ORDER BY 1`,
      [d],
    ),
    pool.query(
      `SELECT COALESCE(endpoint,'(unknown)') AS endpoint, count(*)::int AS calls,
              COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at > ${win}
        GROUP BY 1 ORDER BY cost DESC LIMIT 10`,
      [d],
    ),
    pool.query(
      `SELECT COALESCE(user_id,'(system)') AS user_id, count(*)::int AS calls,
              COALESCE(SUM(cost_usd),0) AS cost
         FROM llm_usage WHERE created_at > ${win}
        GROUP BY 1 ORDER BY cost DESC LIMIT 10`,
      [d],
    ),
  ]);

  const t = totals.rows[0] ?? {};
  return {
    windowDays: days,
    totals: {
      calls: Number(t.calls ?? 0),
      promptTokens: Number(t.pt ?? 0),
      completionTokens: Number(t.ct ?? 0),
      costUsd: Number(t.cost ?? 0),
    },
    byModel: byModel.rows.map((r) => ({
      model: String(r.model),
      calls: Number(r.calls),
      tokens: Number(r.tokens),
      costUsd: Number(r.cost),
    })),
    byDay: byDay.rows.map((r) => ({ day: String(r.day), calls: Number(r.calls), costUsd: Number(r.cost) })),
    byEndpoint: byEndpoint.rows.map((r) => ({
      endpoint: String(r.endpoint),
      calls: Number(r.calls),
      costUsd: Number(r.cost),
    })),
    topUsers: topUsers.rows.map((r) => ({
      userId: String(r.user_id),
      calls: Number(r.calls),
      costUsd: Number(r.cost),
    })),
  };
}

/* ------------------------------- tiers ------------------------------- */

export async function tierOf(userId: string): Promise<string> {
  if (!pool) return DEFAULT_TIER;
  try {
    const r = await pool.query(`SELECT tier FROM user_plans WHERE user_id = $1`, [userId]);
    return r.rows[0] ? String(r.rows[0].tier) : DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}

export async function tiersFor(userIds: string[]): Promise<Record<string, string>> {
  if (!pool || !userIds.length) return {};
  const r = await pool.query(`SELECT user_id, tier FROM user_plans WHERE user_id = ANY($1)`, [userIds]);
  const out: Record<string, string> = {};
  for (const row of r.rows) out[String(row.user_id)] = String(row.tier);
  return out;
}

export async function setTier(
  userId: string,
  tier: string,
  updatedBy: string,
  note?: string,
): Promise<void> {
  if (!pool) throw new Error("plan tiers disabled");
  await pool.query(
    `INSERT INTO user_plans (user_id, tier, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, note = $3, updated_by = $4, updated_at = now()`,
    [userId, tier.slice(0, 30), note?.slice(0, 200) ?? null, updatedBy],
  );
}

/** Counts per tier for the admin overview (users with no row are implicit free). */
export async function tierCounts(): Promise<Record<string, number>> {
  if (!pool) return {};
  const r = await pool.query(`SELECT tier, count(*)::int AS n FROM user_plans GROUP BY tier`);
  const out: Record<string, number> = {};
  for (const row of r.rows) out[String(row.tier)] = Number(row.n);
  return out;
}
