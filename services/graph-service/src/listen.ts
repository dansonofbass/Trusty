/**
 * Listen requests + capacity (Doc #6/#7) — the permission layer around the
 * LISTENS_TO_PERSON edge.
 *
 * A pending request is NOT a graph edge. It lives here (Postgres) and only
 * becomes an edge once the target accepts — "Listen Relationship Created" is the
 * *outcome* of acceptance, not of asking. Mirrors the invites/asks pattern;
 * degrades to a no-op without DATABASE_URL.
 *
 * Capacity is a limited, EARNED resource: base slots + slots earned through
 * meaningful contribution (verified outcomes reported, recommendations authored).
 * Never purchasable — there is deliberately no payment input anywhere here (#7:
 * "capacity increases through meaningful participation rather than payment").
 *
 * The permission POLICY is pluggable (manual | auto_accept) so future policies
 * (org approval, private accounts, …) slot in without redesign.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** All tunable — never hardcoded in business logic. */
export const LISTEN_CONFIG = {
  baseSlots: Number(process.env.LISTEN_BASE_SLOTS ?? 5) || 5,
  contributionPerSlot: Number(process.env.LISTEN_CONTRIBUTION_PER_SLOT ?? 5) || 5,
  maxSlots: Number(process.env.LISTEN_MAX_SLOTS ?? 50) || 50,
  requestTtlDays: Number(process.env.LISTEN_REQUEST_TTL_DAYS ?? 30) || 30,
};

export type ListenPolicy = "manual" | "auto_accept";
export type RequestStatus = "pending" | "accepted" | "declined" | "expired";

export interface ListenRequest {
  id: number;
  requesterId: string;
  targetId: string;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
}

export function listenEnabled(): boolean {
  return !!pool;
}

export async function initListen(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — listen requests disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS listen_requests (
      id           BIGSERIAL PRIMARY KEY,
      requester_id TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at  TIMESTAMPTZ,
      expires_at   TIMESTAMPTZ NOT NULL
    )`);
  // At most ONE pending request per (requester → target).
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS listen_requests_pending_uniq
       ON listen_requests(requester_id, target_id) WHERE status = 'pending'`,
  );
  await p.query(`CREATE INDEX IF NOT EXISTS listen_requests_target_idx ON listen_requests(target_id, status)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS listen_prefs (
      user_id TEXT PRIMARY KEY,
      policy  TEXT NOT NULL DEFAULT 'manual'
    )`);
  pool = p;
  console.log("graph-service: listen requests ready (postgres)");
}

/* ------------------------------- policy ------------------------------- */

export async function getPolicy(userId: string): Promise<ListenPolicy> {
  if (!pool) return "manual";
  const r = await pool.query(`SELECT policy FROM listen_prefs WHERE user_id = $1`, [userId]);
  return (r.rows[0]?.policy as ListenPolicy) ?? "manual";
}

export async function setPolicy(userId: string, policy: ListenPolicy): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO listen_prefs (user_id, policy) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET policy = $2`,
    [userId, policy],
  );
}

/* ----------------------------- contribution ---------------------------- */
/* Contribution — the ONLY thing that earns listen slots — is computed by the
 * Contribution Engine (#20/#21/#22): see `contribution.ts`
 * (`contributionValueFor`). Still evidence-derived, still no payment term. */

/* ------------------------------ requests ------------------------------- */

function rowToRequest(row: pg.QueryResultRow): ListenRequest {
  return {
    id: Number(row.id),
    requesterId: row.requester_id,
    targetId: row.target_id,
    status: row.status as RequestStatus,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/** Ask to listen. Returns the pending request (or the existing one — idempotent). */
export async function createRequest(requesterId: string, targetId: string): Promise<ListenRequest> {
  if (!pool) throw new Error("listen disabled");
  if (requesterId === targetId) throw new Error("cannot listen to yourself");
  const r = await pool.query(
    `INSERT INTO listen_requests (requester_id, target_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' days')::interval)
     ON CONFLICT (requester_id, target_id) WHERE status = 'pending' DO NOTHING
     RETURNING *`,
    [requesterId, targetId, String(LISTEN_CONFIG.requestTtlDays)],
  );
  if (r.rows[0]) return rowToRequest(r.rows[0]);
  // A pending request already exists — return it.
  const existing = await pool.query(
    `SELECT * FROM listen_requests WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'`,
    [requesterId, targetId],
  );
  return rowToRequest(existing.rows[0]);
}

export async function getRequest(id: number): Promise<ListenRequest | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM listen_requests WHERE id = $1`, [id]);
  return r.rows[0] ? rowToRequest(r.rows[0]) : null;
}

/** Pending requests awaiting THIS user's decision (they are the target). */
export async function incomingRequests(userId: string): Promise<ListenRequest[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM listen_requests
      WHERE target_id = $1 AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return r.rows.map(rowToRequest);
}

/** Requests this user has sent that are still pending. */
export async function outgoingRequests(userId: string): Promise<ListenRequest[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM listen_requests
      WHERE requester_id = $1 AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return r.rows.map(rowToRequest);
}

/**
 * Resolve a pending request. Only the TARGET may accept/decline, and only while
 * it is still pending and unexpired. Returns the request on success, null if it
 * wasn't the caller's to resolve (or had already lapsed) — the guard is atomic.
 */
export async function resolveRequest(
  id: number,
  targetId: string,
  status: "accepted" | "declined",
): Promise<ListenRequest | null> {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE listen_requests
        SET status = $3, resolved_at = now()
      WHERE id = $1 AND target_id = $2 AND status = 'pending' AND expires_at > now()
      RETURNING *`,
    [id, targetId, status],
  );
  return r.rows[0] ? rowToRequest(r.rows[0]) : null;
}

/** Mark a request accepted directly (auto-accept policy path). */
export async function markAccepted(id: number): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE listen_requests SET status = 'accepted', resolved_at = now() WHERE id = $1`,
    [id],
  );
}
