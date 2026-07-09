/**
 * Meetings — lightweight 1:1 booking for the summit (mentor sessions, investor
 * meetings, coffee). A requester proposes a slot to a target; the target confirms
 * or declines. Mirrors asks.ts / invites.ts: no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function meetingsEnabled(): boolean {
  return !!pool;
}

export async function initMeetings(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — meetings disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS meetings (
      id            BIGSERIAL PRIMARY KEY,
      requester_id  TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'coffee',
      slot          TEXT,
      location      TEXT,
      note          TEXT,
      status        TEXT NOT NULL DEFAULT 'requested',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Existing installs predate the location column.
  await p.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location TEXT`);
  await p.query(`CREATE INDEX IF NOT EXISTS meetings_target_idx ON meetings(target_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS meetings_requester_idx ON meetings(requester_id, created_at DESC)`);
  pool = p;
  console.log("graph-service: meetings ready (postgres)");
}

export interface Meeting {
  id: string;
  requesterId: string;
  targetId: string;
  kind: string;
  /** Proposed date/time — ISO-ish string from the picker (e.g. "2026-07-28T15:30"). */
  slot?: string;
  /** Where to meet — a predefined venue label or a custom description. */
  location?: string;
  note?: string;
  status: string;
  createdAt: string;
}

const KINDS = new Set(["mentor_1on1", "investor", "coffee", "question"]);

function row(r: Record<string, unknown>): Meeting {
  return {
    id: String(r.id),
    requesterId: String(r.requester_id),
    targetId: String(r.target_id),
    kind: String(r.kind),
    slot: r.slot ? String(r.slot) : undefined,
    location: r.location ? String(r.location) : undefined,
    note: r.note ? String(r.note) : undefined,
    status: String(r.status),
    createdAt: String(r.created_at),
  };
}

export async function createMeeting(input: {
  requesterId: string;
  targetId: string;
  kind?: string;
  slot?: string;
  location?: string;
  note?: string;
}): Promise<Meeting> {
  if (!pool) throw new Error("meetings disabled");
  if (!input.targetId || input.targetId === input.requesterId) throw new Error("bad target");
  const kind = input.kind && KINDS.has(input.kind) ? input.kind : "coffee";
  const r = await pool.query(
    `INSERT INTO meetings (requester_id, target_id, kind, slot, location, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.requesterId, input.targetId, kind, input.slot ?? null, input.location ?? null, input.note ?? null],
  );
  return row(r.rows[0]);
}

/** Only the target may confirm/decline; returns the updated meeting or null. */
export async function respondMeeting(id: string, targetId: string, status: "confirmed" | "declined"): Promise<Meeting | null> {
  if (!pool) throw new Error("meetings disabled");
  const r = await pool.query(
    `UPDATE meetings SET status=$1 WHERE id=$2 AND target_id=$3 AND status='requested' RETURNING *`,
    [status, id, targetId],
  );
  return r.rows[0] ? row(r.rows[0]) : null;
}

/** The viewer's meetings, split into requests coming in vs the ones they sent out. */
export async function myMeetings(userId: string): Promise<{ incoming: Meeting[]; outgoing: Meeting[] }> {
  if (!pool) return { incoming: [], outgoing: [] };
  const [inc, out] = await Promise.all([
    pool.query(`SELECT * FROM meetings WHERE target_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]),
    pool.query(`SELECT * FROM meetings WHERE requester_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId]),
  ]);
  return { incoming: inc.rows.map(row), outgoing: out.rows.map(row) };
}
