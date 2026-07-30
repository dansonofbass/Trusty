/**
 * Group messaging rooms — generic from day one so squad chats today and
 * community-owner groups tomorrow share one engine:
 *
 *   kind "squad": membership is DERIVED from the graph (MEMBER_OF edge) —
 *     the room auto-provisions on first touch; index.ts owns the access check.
 *   kind "group": membership lives in room_members (owner/member roles) —
 *     the future community-groups surface, tables ready now.
 *
 * Messages support reply-to and soft delete. Read state is per user per room
 * (room_reads) and powers unread badges. No-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export interface RoomMessage {
  id: number;
  senderId: string;
  body: string;
  replyTo: number | null;
  createdAt: string;
  deleted: boolean;
}

export function roomsEnabled(): boolean {
  return !!pool;
}

export async function initRooms(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — rooms disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      ref_id     TEXT,
      title      TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id   TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (room_id, user_id)
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id         BIGSERIAL PRIMARY KEY,
      room_id    TEXT NOT NULL,
      sender_id  TEXT NOT NULL,
      body       TEXT NOT NULL,
      reply_to   BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted    BOOLEAN NOT NULL DEFAULT false
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS room_messages_idx ON room_messages(room_id, id DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS room_reads (
      room_id      TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (room_id, user_id)
    )`);
  pool = p;
  console.log("graph-service: rooms ready (postgres)");
}

/** Find-or-create the room for a squad node. Deterministic id. */
export async function ensureSquadRoom(squadNodeId: string, title: string): Promise<string> {
  const id = `room_squad_${squadNodeId}`;
  if (!pool) return id;
  await pool.query(
    `INSERT INTO rooms (id, kind, ref_id, title) VALUES ($1, 'squad', $2, $3)
     ON CONFLICT (id) DO UPDATE SET title = $3`,
    [id, squadNodeId, title],
  );
  return id;
}

export async function getRoom(
  roomId: string,
): Promise<{ id: string; kind: string; refId: string | null; title: string } | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT id, kind, ref_id, title FROM rooms WHERE id = $1`, [roomId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    refId: row.ref_id ? String(row.ref_id) : null,
    title: String(row.title),
  };
}

export async function postMessage(
  roomId: string,
  senderId: string,
  body: string,
  replyTo?: number,
): Promise<RoomMessage> {
  if (!pool) throw new Error("rooms disabled");
  const trimmed = body.trim().slice(0, 4000);
  if (!trimmed) throw new Error("empty message");
  const r = await pool.query(
    `INSERT INTO room_messages (room_id, sender_id, body, reply_to)
     VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [roomId, senderId, trimmed, replyTo ?? null],
  );
  return {
    id: Number(r.rows[0].id),
    senderId,
    body: trimmed,
    replyTo: replyTo ?? null,
    createdAt: new Date(r.rows[0].created_at).toISOString(),
    deleted: false,
  };
}

/** Latest messages (ascending); pass `before` (message id) to page back. */
export async function listMessages(
  roomId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<RoomMessage[]> {
  if (!pool) return [];
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const r = opts.before
    ? await pool.query(
        `SELECT id, sender_id, body, reply_to, created_at, deleted FROM room_messages
          WHERE room_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
        [roomId, opts.before, limit],
      )
    : await pool.query(
        `SELECT id, sender_id, body, reply_to, created_at, deleted FROM room_messages
          WHERE room_id = $1 ORDER BY id DESC LIMIT $2`,
        [roomId, limit],
      );
  return r.rows.reverse().map((row) => ({
    id: Number(row.id),
    senderId: String(row.sender_id),
    body: row.deleted ? "" : String(row.body),
    replyTo: row.reply_to != null ? Number(row.reply_to) : null,
    createdAt: new Date(row.created_at).toISOString(),
    deleted: !!row.deleted,
  }));
}

/** Soft-delete own message. */
export async function deleteMessage(roomId: string, messageId: number, userId: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE room_messages SET deleted = true, body = '' WHERE id = $1 AND room_id = $2 AND sender_id = $3`,
    [messageId, roomId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markRoomRead(roomId: string, userId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO room_reads (room_id, user_id, last_read_at) VALUES ($1, $2, now())
     ON CONFLICT (room_id, user_id) DO UPDATE SET last_read_at = now()`,
    [roomId, userId],
  );
}

/** Room summary for the list view: last message + unread count for the viewer. */
export async function roomSummary(
  roomId: string,
  userId: string,
): Promise<{ lastMessage: RoomMessage | null; unread: number }> {
  if (!pool) return { lastMessage: null, unread: 0 };
  const last = await pool.query(
    `SELECT id, sender_id, body, reply_to, created_at, deleted FROM room_messages
      WHERE room_id = $1 AND deleted = false ORDER BY id DESC LIMIT 1`,
    [roomId],
  );
  const unread = await pool.query(
    `SELECT count(*) AS n FROM room_messages m
      WHERE m.room_id = $1 AND m.deleted = false AND m.sender_id <> $2
        AND m.created_at > COALESCE(
          (SELECT last_read_at FROM room_reads WHERE room_id = $1 AND user_id = $2),
          'epoch'::timestamptz)`,
    [roomId, userId],
  );
  const row = last.rows[0];
  return {
    lastMessage: row
      ? {
          id: Number(row.id),
          senderId: String(row.sender_id),
          body: String(row.body),
          replyTo: row.reply_to != null ? Number(row.reply_to) : null,
          createdAt: new Date(row.created_at).toISOString(),
          deleted: false,
        }
      : null,
    unread: Number(unread.rows[0]?.n ?? 0),
  };
}

/** Per-squad chatter for the Discover activity feed: messages in the last
 *  24h + most recent message time, for every squad room that has any. */
export async function squadChatter(): Promise<
  { squadNodeId: string; messages24h: number; lastAt: string }[]
> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT r.ref_id, count(*) FILTER (WHERE m.created_at > now() - interval '24 hours') AS n24,
            max(m.created_at) AS last_at
       FROM rooms r JOIN room_messages m ON m.room_id = r.id AND m.deleted = false
      WHERE r.kind = 'squad'
      GROUP BY r.ref_id
      HAVING max(m.created_at) > now() - interval '7 days'`,
  );
  return r.rows
    .filter((row) => row.ref_id)
    .map((row) => ({
      squadNodeId: String(row.ref_id),
      messages24h: Number(row.n24 ?? 0),
      lastAt: new Date(row.last_at).toISOString(),
    }));
}

/** Total messages in the last N hours — a system.stats gauge. */
export async function countRecentMessages(hours = 24): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT count(*) AS n FROM room_messages WHERE created_at > now() - ($1 || ' hours')::interval`,
    [Math.max(1, Math.floor(hours))],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Recent squad joins for the activity feed (logged by the join route). */
export async function logSquadJoin(squadNodeId: string, memberId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS squad_joins (
       id BIGSERIAL PRIMARY KEY, squad_node_id TEXT NOT NULL, member_id TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await pool.query(`INSERT INTO squad_joins (squad_node_id, member_id) VALUES ($1, $2)`, [
    squadNodeId,
    memberId,
  ]);
}

export async function recentSquadJoins(
  limit = 20,
): Promise<{ squadNodeId: string; memberId: string; createdAt: string }[]> {
  if (!pool) return [];
  try {
    const r = await pool.query(
      `SELECT squad_node_id, member_id, created_at FROM squad_joins ORDER BY id DESC LIMIT $1`,
      [Math.min(limit, 50)],
    );
    return r.rows.map((row) => ({
      squadNodeId: String(row.squad_node_id),
      memberId: String(row.member_id),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  } catch {
    return []; // table appears with the first join
  }
}
