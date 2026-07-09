/**
 * Place links — tracks Google/Yandex Maps URLs submitted for on-demand import.
 * graph-service publishes each to NATS; the places connector resolves it and
 * publishes a result we record here (status → resolved/failed + node id).
 * Mirrors the savedPlaces/placeSuggestions module pattern; no-op without DB.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function placeLinksEnabled(): boolean {
  return !!pool;
}

export async function initPlaceLinks(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — place links disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS place_links (
      id           BIGSERIAL PRIMARY KEY,
      url          TEXT NOT NULL,
      source       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',
      node_id      TEXT,
      label        TEXT,
      error        TEXT,
      submitted_by TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at  TIMESTAMPTZ
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS place_links_created_idx ON place_links(created_at DESC)`);
  pool = p;
  console.log("graph-service: place links ready (postgres)");
}

export interface PlaceLink {
  id: number;
  url: string;
  source: string;
  status: string;
  nodeId?: string;
  label?: string;
  error?: string;
  submittedBy: string;
  createdAt: string;
}

/** Record a submitted link (status=queued). Returns its id (0 if disabled). */
export async function createPlaceLink(url: string, source: string, submittedBy: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `INSERT INTO place_links (url, source, submitted_by) VALUES ($1,$2,$3) RETURNING id`,
    [url, source, submittedBy],
  );
  return Number(r.rows[0]?.id ?? 0);
}

/** Record the connector's resolution outcome for a link. */
export async function resolvePlaceLink(
  id: number,
  r: { ok: boolean; nodeId?: string; label?: string; error?: string },
): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `UPDATE place_links SET status = $2, node_id = $3, label = $4, error = $5, resolved_at = now() WHERE id = $1`,
      [id, r.ok ? "resolved" : "failed", r.nodeId ?? null, r.label ?? null, r.error ?? null],
    )
    .catch((e) => console.error("graph-service: resolvePlaceLink failed:", e instanceof Error ? e.message : e));
}

/** Remove a link-history row (dismiss). */
export async function deletePlaceLink(id: number): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM place_links WHERE id = $1`, [id]).catch(() => undefined);
}

export async function listPlaceLinks(limit = 50): Promise<PlaceLink[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM place_links ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows.map((row) => ({
    id: Number(row.id),
    url: String(row.url),
    source: String(row.source),
    status: String(row.status),
    nodeId: row.node_id ?? undefined,
    label: row.label ?? undefined,
    error: row.error ?? undefined,
    submittedBy: String(row.submitted_by),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}
