/**
 * User notifications — derived from domain events at the emit chokepoint
 * (index.ts registers a deriver via setEventHook), never written ad-hoc from
 * route handlers. Each row targets ONE user; actor label is denormalized at
 * insert time so listing never touches the graph.
 *
 * Mirrors squads.ts; no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export interface NotificationRow {
  id: number;
  type: string;
  actorId: string | null;
  actorLabel: string | null;
  text: string;
  targetId: string | null;
  createdAt: string;
  read: boolean;
}

export function notificationsEnabled(): boolean {
  return !!pool;
}

export async function initNotifications(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — notifications disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      actor_id    TEXT,
      actor_label TEXT,
      text        TEXT NOT NULL,
      target_id   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at     TIMESTAMPTZ
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, id DESC)`);
  pool = p;
  console.log("graph-service: notifications ready (postgres)");
}

/** Insert one notification (fire-and-forget safe — callers don't await). */
export async function addNotification(n: {
  userId: string;
  type: string;
  text: string;
  actorId?: string;
  actorLabel?: string;
  targetId?: string;
}): Promise<void> {
  if (!pool) return;
  if (!n.userId || n.userId === n.actorId) return; // never notify yourself
  // Collapse rapid duplicates (same actor, same type, same target, same day).
  await pool.query(
    `INSERT INTO notifications (user_id, type, actor_id, actor_label, text, target_id)
     SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications
         WHERE user_id = $1 AND type = $2 AND actor_id IS NOT DISTINCT FROM $3
           AND target_id IS NOT DISTINCT FROM $6 AND created_at > now() - interval '1 day'
      )`,
    [n.userId, n.type, n.actorId ?? null, n.actorLabel ?? null, n.text, n.targetId ?? null],
  );
}

export async function listNotifications(
  userId: string,
  limit = 40,
): Promise<{ items: NotificationRow[]; unread: number }> {
  if (!pool) return { items: [], unread: 0 };
  const r = await pool.query(
    `SELECT id, type, actor_id, actor_label, text, target_id, created_at, read_at
       FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  const u = await pool.query(
    `SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return {
    items: r.rows.map((row) => ({
      id: Number(row.id),
      type: String(row.type),
      actorId: row.actor_id ? String(row.actor_id) : null,
      actorLabel: row.actor_label ? String(row.actor_label) : null,
      text: String(row.text),
      targetId: row.target_id ? String(row.target_id) : null,
      createdAt: new Date(row.created_at).toISOString(),
      read: !!row.read_at,
    })),
    unread: Number(u.rows[0]?.n ?? 0),
  };
}

export async function unreadCount(userId: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Mark all (or specific ids) read. */
export async function markNotificationsRead(userId: string, ids?: number[]): Promise<void> {
  if (!pool) return;
  if (ids && ids.length) {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])`,
      [userId, ids],
    );
  } else {
    await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  }
}
