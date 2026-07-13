/**
 * Invites — the friend-connection + growth-instrumentation layer (Phase 2).
 *
 * An invite is a shareable code owned by a user. Its whole point is the funnel:
 * we log every stage (created → visited → accepted) into an append-only
 * `invite_events` table so invite→signup conversion — the core growth metric —
 * is measurable from day one, both in aggregate and per-link (so the inviter can
 * see who joined). The friendship edge itself lives in the graph (graph-core);
 * this module owns the code registry + the funnel.
 *
 * Degrades gracefully: if DATABASE_URL is unset, invites are disabled and the
 * endpoints report it rather than silently dropping data.
 */
import pg from "pg";
import { randomBytes } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** How many people a single invite link may bring in, unless overridden per-link. */
export const INVITE_DEFAULT_MAX_USES = Math.max(
  1,
  Number(process.env.INVITE_DEFAULT_MAX_USES ?? 5) || 5,
);

export function invitesEnabled(): boolean {
  return !!pool;
}

export async function initInvites(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — invites disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      inviter_id  TEXT NOT NULL,
      note        TEXT,
      max_uses    INT NOT NULL DEFAULT 5,
      revoked     BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Migrate older tables that predate the quota column.
  await p.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS max_uses INT NOT NULL DEFAULT 5`);
  await p.query(`CREATE INDEX IF NOT EXISTS invites_inviter_idx ON invites(inviter_id, created_at DESC)`);
  // The funnel: one row per stage. `invitee_id` is set once someone accepts.
  await p.query(`
    CREATE TABLE IF NOT EXISTS invite_events (
      id          BIGSERIAL PRIMARY KEY,
      code        TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
      kind        TEXT NOT NULL,          -- created | visited | accepted
      invitee_id  TEXT,
      detail      JSONB,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS invite_events_code_idx ON invite_events(code, at)`);
  // One accepted row per (code, invitee) — re-accepting doesn't double-count.
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS invite_events_accept_uniq
       ON invite_events(code, invitee_id) WHERE kind = 'accepted'`,
  );
  pool = p;
  console.log("graph-service: invites ready (postgres)");
}

/** Short, URL-safe, unguessable code (~48 bits — plenty for share links). */
function newCode(): string {
  return randomBytes(9).toString("base64url");
}

export interface InviteMeta {
  code: string;
  inviterId: string;
  note?: string;
  maxUses: number;
  revoked: boolean;
}

export async function createInvite(
  inviterId: string,
  note?: string,
  maxUses: number = INVITE_DEFAULT_MAX_USES,
): Promise<InviteMeta> {
  if (!pool) throw new Error("invites disabled");
  const cap = Math.max(1, Math.floor(maxUses) || INVITE_DEFAULT_MAX_USES);
  // Retry once on the astronomically-unlikely code collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    try {
      await pool.query(
        `INSERT INTO invites (code, inviter_id, note, max_uses) VALUES ($1, $2, $3, $4)`,
        [code, inviterId, note ?? null, cap],
      );
      await pool.query(`INSERT INTO invite_events (code, kind) VALUES ($1, 'created')`, [code]);
      return { code, inviterId, note, maxUses: cap, revoked: false };
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  throw new Error("could not allocate invite code");
}

export async function getInvite(code: string): Promise<InviteMeta | null> {
  if (!pool) return null;
  const r = await pool.query(
    `SELECT code, inviter_id, note, max_uses, revoked FROM invites WHERE code = $1`,
    [code],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    code: row.code,
    inviterId: row.inviter_id,
    note: row.note ?? undefined,
    maxUses: Number(row.max_uses ?? INVITE_DEFAULT_MAX_USES),
    revoked: row.revoked,
  };
}

/** How many distinct people have accepted this invite (the funnel is the source of truth). */
export async function acceptedCount(code: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM invite_events WHERE code = $1 AND kind = 'accepted'`,
    [code],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export type ConsumeResult =
  | { ok: true; inviterId: string; firstTime: boolean }
  | { ok: false; reason: "disabled" | "invalid" | "revoked" | "self" | "exhausted" };

/**
 * Validate + consume an invite for a joining user. Records the acceptance in the
 * funnel (idempotent per invitee). Rejects revoked / self / over-quota invites.
 * Consumption is deliberately NOT a graph edge — the INVITED edge is created only
 * after onboarding completes (graph-core `addInviteEdge`).
 */
export async function consumeInvite(code: string, inviteeId: string): Promise<ConsumeResult> {
  if (!pool) return { ok: false, reason: "disabled" };
  const invite = await getInvite(code);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.revoked) return { ok: false, reason: "revoked" };
  if (invite.inviterId === inviteeId) return { ok: false, reason: "self" };
  // Already accepted by this invitee? Idempotent success (re-entry is fine).
  const firstTime = await recordAccepted(code, inviteeId);
  if (!firstTime) return { ok: true, inviterId: invite.inviterId, firstTime: false };
  // First-time accept: enforce the quota AFTER recording, then roll back if over.
  const used = await acceptedCount(code);
  if (used > invite.maxUses) {
    await pool
      .query(`DELETE FROM invite_events WHERE code = $1 AND kind = 'accepted' AND invitee_id = $2`, [
        code,
        inviteeId,
      ])
      .catch(() => undefined);
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true, inviterId: invite.inviterId, firstTime: true };
}

/** Log a landing-page view (best-effort — a bad code is just ignored). */
export async function recordVisit(code: string, detail?: Record<string, unknown>): Promise<void> {
  if (!pool) return;
  await pool
    .query(`INSERT INTO invite_events (code, kind, detail) VALUES ($1, 'visited', $2)`, [
      code,
      detail ? JSON.stringify(detail) : null,
    ])
    .catch(() => undefined);
}

/** Log a conversion. Returns false if this invitee already accepted this code. */
export async function recordAccepted(code: string, inviteeId: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `INSERT INTO invite_events (code, kind, invitee_id) VALUES ($1, 'accepted', $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [code, inviteeId],
  );
  return (r.rowCount ?? 0) > 0;
}

export interface InviteRow {
  code: string;
  note?: string;
  revoked: boolean;
  maxUses: number;
  createdAt: string;
  visits: number;
  joined: number;
  joinedIds: string[];
}

/** The inviter's links with per-link funnel counts (newest first). */
export async function listInvitesFor(inviterId: string): Promise<InviteRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT i.code, i.note, i.revoked, i.max_uses, i.created_at,
            COUNT(*) FILTER (WHERE e.kind = 'visited')  AS visits,
            COUNT(*) FILTER (WHERE e.kind = 'accepted') AS joined,
            COALESCE(
              ARRAY_AGG(e.invitee_id) FILTER (WHERE e.kind = 'accepted'),
              '{}'
            ) AS joined_ids
       FROM invites i
       LEFT JOIN invite_events e ON e.code = i.code
      WHERE i.inviter_id = $1
      GROUP BY i.code, i.note, i.revoked, i.max_uses, i.created_at
      ORDER BY i.created_at DESC
      LIMIT 100`,
    [inviterId],
  );
  return r.rows.map((row) => ({
    code: row.code,
    note: row.note ?? undefined,
    revoked: row.revoked,
    maxUses: Number(row.max_uses ?? INVITE_DEFAULT_MAX_USES),
    createdAt: row.created_at,
    visits: Number(row.visits),
    joined: Number(row.joined),
    joinedIds: (row.joined_ids as string[]).filter(Boolean),
  }));
}

export interface InviteStats {
  invitesCreated: number;
  totalVisits: number;
  totalJoined: number;
  /** joined / created, 0..1 — the headline conversion number. */
  conversion: number;
}

export async function inviteStats(inviterId: string): Promise<InviteStats> {
  if (!pool) return { invitesCreated: 0, totalVisits: 0, totalJoined: 0, conversion: 0 };
  const r = await pool.query(
    `SELECT
       COUNT(DISTINCT i.code)                                        AS created,
       COUNT(*) FILTER (WHERE e.kind = 'visited')                    AS visits,
       COUNT(*) FILTER (WHERE e.kind = 'accepted')                   AS joined
     FROM invites i
     LEFT JOIN invite_events e ON e.code = i.code
     WHERE i.inviter_id = $1`,
    [inviterId],
  );
  const created = Number(r.rows[0]?.created ?? 0);
  const joined = Number(r.rows[0]?.joined ?? 0);
  return {
    invitesCreated: created,
    totalVisits: Number(r.rows[0]?.visits ?? 0),
    totalJoined: joined,
    conversion: created > 0 ? joined / created : 0,
  };
}
