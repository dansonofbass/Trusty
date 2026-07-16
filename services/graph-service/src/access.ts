/**
 * Access control — the invite-only front-door gate.
 *
 * Keycloak still mints every identity; the *app* decides whether that identity
 * has access to the product, via a per-user `account_status`:
 *
 *   waitlisted         → no product access; sees the waitlist screen only
 *   pending_onboarding → invited (or unlocked from the waitlist); may onboard
 *   active             → onboarding complete; full access
 *
 * This is the server-authoritative source for the spec's immutable "account
 * status" identity field. Enforcement is at the single JIT provisioning choke
 * point (ensureUser) + the web app branching on GET /api/access. The status is
 * NOT trust and NOT a graph edge — it's pure access state.
 *
 * Degrades gracefully: without DATABASE_URL the module is a no-op and callers
 * treat everyone as `active` (open mode, matching pre-gate behaviour).
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export type AccountStatus = "waitlisted" | "pending_onboarding" | "active";

export interface AccessRow {
  userId: string;
  status: AccountStatus;
  inviteCode?: string;
  inviterId?: string;
  waitlistCode?: string;
  unlockedAt?: string;
  createdAt: string;
}

export function accessEnabled(): boolean {
  return !!pool;
}

export async function initAccess(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — access gating disabled (open mode)");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_access (
      user_id       TEXT PRIMARY KEY,
      status        TEXT NOT NULL DEFAULT 'waitlisted',
      invite_code   TEXT,
      inviter_id    TEXT,
      waitlist_code TEXT,
      unlocked_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  pool = p;
  console.log("graph-service: access gating ready (postgres)");
}

function rowToAccess(row: pg.QueryResultRow): AccessRow {
  return {
    userId: row.user_id,
    status: row.status as AccountStatus,
    inviteCode: row.invite_code ?? undefined,
    inviterId: row.inviter_id ?? undefined,
    waitlistCode: row.waitlist_code ?? undefined,
    unlockedAt: row.unlocked_at ? new Date(row.unlocked_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getAccess(userId: string): Promise<AccessRow | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM user_access WHERE user_id = $1`, [userId]);
  return r.rows[0] ? rowToAccess(r.rows[0]) : null;
}

/** All access rows in one status — powers the admin waitlist review queue. */
export async function listAccess(status: AccountStatus): Promise<AccessRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM user_access WHERE status = $1 ORDER BY created_at DESC LIMIT 500`,
    [status],
  );
  return r.rows.map(rowToAccess);
}

/**
 * Create the access row on first sight if absent. `defaultStatus` grandfathers
 * pre-gate users in as `active` (callers pass "active" for already-existing
 * graph nodes) while brand-new identities default to `waitlisted` (no invite =
 * no access). Never downgrades an existing row.
 */
export async function ensureAccess(
  userId: string,
  defaultStatus: AccountStatus,
): Promise<AccessRow | null> {
  if (!pool) return null;
  await pool.query(
    `INSERT INTO user_access (user_id, status) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, defaultStatus],
  );
  return getAccess(userId);
}

export async function setStatus(userId: string, status: AccountStatus): Promise<void> {
  if (!pool) return;
  // Qualify `unlocked_at` — in ON CONFLICT DO UPDATE a bare column reference is
  // ambiguous (target row vs EXCLUDED).
  const unlocked =
    status === "pending_onboarding" ? `, unlocked_at = COALESCE(user_access.unlocked_at, now())` : ``;
  await pool.query(
    `INSERT INTO user_access (user_id, status) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET status = $2${unlocked}`,
    [userId, status],
  );
}

/** Bind an accepted invite: records origin + grants onboarding access. */
export async function bindInvite(userId: string, code: string, inviterId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_access (user_id, status, invite_code, inviter_id)
       VALUES ($1, 'pending_onboarding', $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET status = 'pending_onboarding',
           invite_code = EXCLUDED.invite_code,
           inviter_id = EXCLUDED.inviter_id`,
    [userId, code, inviterId],
  );
}

/** Bind a waitlist join: no product access until referrals unlock it. */
export async function bindWaitlist(userId: string, code: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_access (user_id, status, waitlist_code)
       VALUES ($1, 'waitlisted', $2)
     ON CONFLICT (user_id) DO UPDATE
       SET waitlist_code = EXCLUDED.waitlist_code,
           status = CASE WHEN user_access.status = 'active'
                         THEN user_access.status ELSE 'waitlisted' END`,
    [userId, code],
  );
}
