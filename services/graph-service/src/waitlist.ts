/**
 * Waitlist — the controlled-growth mechanism for non-invited visitors (spec #3).
 *
 * A waitlisted user is NOT rejected: they get a personal referral link and unlock
 * full access once a configurable number of people they refer join and complete
 * onboarding. The referral link is an ordinary invite (its inviter is the
 * waitlisted user), so the existing invite funnel does the plumbing; this module
 * only owns the waitlist registry + the unlock counter.
 *
 * The unlock threshold is configurable (never hardcoded in business logic) via
 * WAITLIST_UNLOCK_THRESHOLD. Degrades gracefully without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** How many referred sign-ups a waitlisted user must bring in to unlock access. */
export const WAITLIST_UNLOCK_THRESHOLD = Math.max(
  1,
  Number(process.env.WAITLIST_UNLOCK_THRESHOLD ?? 3) || 3,
);

export function waitlistEnabled(): boolean {
  return !!pool;
}

export async function initWaitlist(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — waitlist disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      user_id        TEXT PRIMARY KEY,
      code           TEXT NOT NULL,
      email          TEXT,
      referred_count INT NOT NULL DEFAULT 0,
      unlocked       BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS waitlist_code_uniq ON waitlist(code)`);
  // One waitlist entry per email (best-effort dedup; NULLs are allowed to repeat).
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_uniq ON waitlist(lower(email)) WHERE email IS NOT NULL`);
  pool = p;
  console.log("graph-service: waitlist ready (postgres)");
}

export interface WaitlistEntry {
  userId: string;
  code: string;
  email?: string;
  referredCount: number;
  threshold: number;
  unlocked: boolean;
  createdAt: string;
}

function rowToEntry(row: pg.QueryResultRow): WaitlistEntry {
  return {
    userId: row.user_id,
    code: row.code,
    email: row.email ?? undefined,
    referredCount: Number(row.referred_count ?? 0),
    threshold: WAITLIST_UNLOCK_THRESHOLD,
    unlocked: !!row.unlocked,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getWaitlistByUser(userId: string): Promise<WaitlistEntry | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM waitlist WHERE user_id = $1`, [userId]);
  return r.rows[0] ? rowToEntry(r.rows[0]) : null;
}

/**
 * Register (or return the existing) waitlist entry for a user. `referralCode` is
 * an invite code minted by the caller (inviter = this user) — reusing the invite
 * funnel for referral tracking. Idempotent: re-joining returns the same entry.
 */
export async function joinWaitlist(
  userId: string,
  referralCode: string,
  email?: string,
): Promise<WaitlistEntry> {
  if (!pool) throw new Error("waitlist disabled");
  const existing = await getWaitlistByUser(userId);
  if (existing) return existing;
  await pool.query(
    `INSERT INTO waitlist (user_id, code, email) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, referralCode, email?.trim() || null],
  );
  return (await getWaitlistByUser(userId))!;
}

export interface ReferralResult {
  found: boolean;
  referredCount: number;
  threshold: number;
  /** True only on the transition that crosses the threshold (fire-once). */
  unlockedNow: boolean;
}

/**
 * A person referred by `referrerUserId` just completed onboarding. If the
 * referrer is a still-locked waitlist user, bump their counter and report
 * whether this crossed the unlock threshold. No-op for non-waitlist referrers.
 */
export async function incrementReferral(referrerUserId: string): Promise<ReferralResult> {
  const miss: ReferralResult = {
    found: false,
    referredCount: 0,
    threshold: WAITLIST_UNLOCK_THRESHOLD,
    unlockedNow: false,
  };
  if (!pool) return miss;
  const r = await pool.query(
    `UPDATE waitlist
        SET referred_count = referred_count + 1,
            unlocked = (referred_count + 1 >= $2)
      WHERE user_id = $1 AND unlocked = false
      RETURNING referred_count, unlocked`,
    [referrerUserId, WAITLIST_UNLOCK_THRESHOLD],
  );
  const row = r.rows[0];
  if (!row) return miss; // not a waitlist user, or already unlocked
  return {
    found: true,
    referredCount: Number(row.referred_count),
    threshold: WAITLIST_UNLOCK_THRESHOLD,
    unlockedNow: !!row.unlocked,
  };
}
