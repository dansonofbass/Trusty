/**
 * Credits — controlled access to platform capabilities (#23).
 *
 * Credits are NOT currency, NOT trust, NOT contribution, NOT transferable.
 * They unlock product features only, and must never influence trust,
 * reputation or recommendation ranking — structurally guaranteed: nothing in
 * the trust/ranking pipelines imports this module.
 *
 * Balance = EARNED (derived live from validated Contribution — never stored,
 * same philosophy as the engine itself) + the append-only ledger (admin
 * grants +, spends −). Every credit movement is auditable (#23 "every credit
 * source should remain auditable").
 *
 * V1 consumer: a temporary Listen-capacity boost (#23 lists "temporary
 * capacity expansion" as a credit-consumable) — spend N credits, get +1 slot
 * for D days. Degrades to a no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** All tunable — never hardcoded in business logic. */
export const CREDITS_CONFIG = {
  /** Contribution points that derive one earned credit. */
  pointsPerCredit: Math.max(0.5, Number(process.env.CREDITS_POINTS_PER_CREDIT ?? 2) || 2),
  /** Temporary capacity boost: cost, duration, size, and concurrency cap. */
  boostCost: Math.max(1, Number(process.env.LISTEN_BOOST_COST ?? 3) || 3),
  boostDays: Math.max(1, Number(process.env.LISTEN_BOOST_DAYS ?? 30) || 30),
  boostSlots: Math.max(1, Number(process.env.LISTEN_BOOST_SLOTS ?? 1) || 1),
  maxActiveBoosts: Math.max(1, Number(process.env.LISTEN_BOOST_MAX_ACTIVE ?? 3) || 3),
};

export function creditsEnabled(): boolean {
  return !!pool;
}

export async function initCredits(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — credits disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS credits_ledger (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      delta      REAL NOT NULL,
      reason     TEXT NOT NULL,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS credits_ledger_user_idx ON credits_ledger(user_id, created_at)`);
  pool = p;
  console.log("graph-service: credits ledger ready (postgres)");
}

/** Credits earned from validated Contribution — derived, never stored. */
export function earnedCredits(contributionScore: number): number {
  return Math.floor(Math.max(0, contributionScore) / CREDITS_CONFIG.pointsPerCredit);
}

/** Net of the ledger (grants − spends). */
export async function ledgerSum(userId: string): Promise<number> {
  if (!pool) return 0;
  try {
    const r = await pool.query(
      `SELECT COALESCE(SUM(delta), 0) AS s FROM credits_ledger WHERE user_id = $1`,
      [userId],
    );
    return Number(r.rows[0]?.s ?? 0);
  } catch {
    return 0;
  }
}

export interface CreditEntry {
  id: number;
  delta: number;
  reason: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export async function creditHistory(userId: string, limit = 50): Promise<CreditEntry[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM credits_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    delta: Number(row.delta),
    reason: String(row.reason),
    detail: (row.detail as Record<string, unknown>) ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** Admin grant — auditable (records who granted and why). */
export async function grantCredits(
  userId: string,
  amount: number,
  grantedBy: string,
  note?: string,
): Promise<void> {
  if (!pool) throw new Error("credits disabled");
  const amt = Math.min(1000, Math.max(1, Math.floor(amount)));
  await pool.query(
    `INSERT INTO credits_ledger (user_id, delta, reason, detail) VALUES ($1, $2, 'admin_grant', $3)`,
    [userId, amt, JSON.stringify({ by: grantedBy, note: note?.slice(0, 200) })],
  );
}

/** Active (unexpired) capacity-boost slots for a user. */
export async function activeBoostSlots(userId: string): Promise<number> {
  if (!pool) return 0;
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM credits_ledger
        WHERE user_id = $1 AND reason = 'capacity_boost'
          AND (detail->>'expiresAt')::timestamptz > now()`,
      [userId],
    );
    return Number(r.rows[0]?.n ?? 0) * CREDITS_CONFIG.boostSlots;
  } catch {
    return 0;
  }
}

export type BoostResult =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: "insufficient_credits" | "boost_limit" | "disabled" };

/**
 * Spend credits on a temporary capacity boost. The balance guard and the
 * concurrent-boost cap live INSIDE the insert statement, so the spend is
 * atomic — no separate check-then-write race. `earned` (contribution-derived
 * credits) is computed by the caller and folded into the guard.
 */
export async function spendForBoost(userId: string, earned: number): Promise<BoostResult> {
  if (!pool) return { ok: false, reason: "disabled" };
  const expires = new Date(Date.now() + CREDITS_CONFIG.boostDays * 86_400_000).toISOString();
  const r = await pool.query(
    `INSERT INTO credits_ledger (user_id, delta, reason, detail)
     SELECT $1, $2, 'capacity_boost', $3
      WHERE (SELECT COALESCE(SUM(delta), 0) FROM credits_ledger WHERE user_id = $1) + $4 >= $5
        AND (SELECT count(*) FROM credits_ledger
              WHERE user_id = $1 AND reason = 'capacity_boost'
                AND (detail->>'expiresAt')::timestamptz > now()) < $6
     RETURNING id`,
    [
      userId,
      -CREDITS_CONFIG.boostCost,
      JSON.stringify({ expiresAt: expires, slots: CREDITS_CONFIG.boostSlots }),
      earned,
      CREDITS_CONFIG.boostCost,
      CREDITS_CONFIG.maxActiveBoosts,
    ],
  );
  if (r.rows[0]) return { ok: true, expiresAt: expires };
  // Distinguish the two guard failures for a helpful error message.
  const boosts = await activeBoostSlots(userId);
  return boosts >= CREDITS_CONFIG.maxActiveBoosts * CREDITS_CONFIG.boostSlots
    ? { ok: false, reason: "boost_limit" }
    : { ok: false, reason: "insufficient_credits" };
}
