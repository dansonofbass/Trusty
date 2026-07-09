/**
 * Saved places — a per-user bookmark list ("Save to a list"). A lightweight,
 * private overlay on the shared catalog: saving a place does NOT create a trust
 * edge (that's a separate, stronger signal) — it just remembers it for later.
 *
 * Mirrors the trustLog pattern; degrades to a no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function savedPlacesEnabled(): boolean {
  return !!pool;
}

export async function initSavedPlaces(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — saved places disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS saved_places (
      user_id  TEXT NOT NULL,
      node_id  TEXT NOT NULL,
      list     TEXT NOT NULL DEFAULT 'saved',
      note     TEXT,
      at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, node_id, list)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS saved_places_user_idx ON saved_places(user_id, at DESC)`);
  pool = p;
  console.log("graph-service: saved places ready (postgres)");
}

/** Add a place to the user's list (idempotent). */
export async function savePlace(userId: string, nodeId: string, list = "saved", note?: string): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO saved_places (user_id, node_id, list, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, node_id, list) DO UPDATE SET note = COALESCE(EXCLUDED.note, saved_places.note)`,
      [userId, nodeId, list, note ?? null],
    )
    .catch((e) => console.error("graph-service: savePlace failed:", e instanceof Error ? e.message : e));
}

/** Remove a place from the user's list. */
export async function unsavePlace(userId: string, nodeId: string, list = "saved"): Promise<void> {
  if (!pool) return;
  await pool
    .query(`DELETE FROM saved_places WHERE user_id = $1 AND node_id = $2 AND list = $3`, [userId, nodeId, list])
    .catch((e) => console.error("graph-service: unsavePlace failed:", e instanceof Error ? e.message : e));
}

/** Is this place on any of the user's lists? */
export async function isSaved(userId: string, nodeId: string): Promise<boolean> {
  if (!pool) return false;
  try {
    const r = await pool.query(`SELECT 1 FROM saved_places WHERE user_id = $1 AND node_id = $2 LIMIT 1`, [
      userId,
      nodeId,
    ]);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export interface SavedPlaceRow {
  nodeId: string;
  list: string;
  note?: string;
  at: string;
}

/** The user's saved places, newest first. */
export async function listSaved(userId: string): Promise<SavedPlaceRow[]> {
  if (!pool) return [];
  try {
    const r = await pool.query(
      `SELECT node_id, list, note, at FROM saved_places WHERE user_id = $1 ORDER BY at DESC LIMIT 500`,
      [userId],
    );
    return r.rows.map((row) => ({
      nodeId: String(row.node_id),
      list: String(row.list),
      note: row.note ?? undefined,
      at: (row.at instanceof Date ? row.at.toISOString() : String(row.at)),
    }));
  } catch {
    return [];
  }
}
