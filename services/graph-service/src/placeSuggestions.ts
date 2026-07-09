/**
 * Place edit suggestions — the "Suggest an edit" moderation queue. Any user can
 * propose a patch to a place's core fields; an admin approves (applies via
 * updateEntity) or rejects. Mirrors the savedPlaces/trustLog module pattern;
 * degrades to a no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function placeSuggestionsEnabled(): boolean {
  return !!pool;
}

export async function initPlaceSuggestions(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — place suggestions disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS place_suggestions (
      id          BIGSERIAL PRIMARY KEY,
      place_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'edit',
      patch       JSONB NOT NULL,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ
    )`);
  // Backfill for tables created before the `kind` column existed.
  await p.query(`ALTER TABLE place_suggestions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'edit'`);
  await p.query(`CREATE INDEX IF NOT EXISTS place_suggestions_status_idx ON place_suggestions(status, created_at DESC)`);
  pool = p;
  console.log("graph-service: place suggestions ready (postgres)");
}

/** What a pending suggestion proposes. */
export type SuggestionKind = "edit" | "photo" | "menu";

export interface Suggestion {
  id: number;
  placeId: string;
  userId: string;
  kind: SuggestionKind;
  patch: Record<string, unknown>;
  note?: string;
  status: string;
  createdAt: string;
}

/** File a suggestion. Returns its id (0 when the queue is disabled). */
export async function createSuggestion(input: {
  placeId: string;
  userId: string;
  kind?: SuggestionKind;
  patch: Record<string, unknown>;
  note?: string;
}): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `INSERT INTO place_suggestions (place_id, user_id, kind, patch, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.placeId, input.userId, input.kind ?? "edit", JSON.stringify(input.patch), input.note ?? null],
  );
  return Number(r.rows[0]?.id ?? 0);
}

const rowToSuggestion = (row: Record<string, unknown>): Suggestion => ({
  id: Number(row.id),
  placeId: String(row.place_id),
  userId: String(row.user_id),
  kind: (String(row.kind ?? "edit") as SuggestionKind),
  patch: (row.patch as Record<string, unknown>) ?? {},
  note: (row.note as string) ?? undefined,
  status: String(row.status),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
});

export async function listSuggestions(status = "pending"): Promise<Suggestion[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM place_suggestions WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
    [status],
  );
  return r.rows.map(rowToSuggestion);
}

export async function getSuggestion(id: number): Promise<Suggestion | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM place_suggestions WHERE id = $1`, [id]);
  return r.rows[0] ? rowToSuggestion(r.rows[0]) : null;
}

export async function setSuggestionStatus(id: number, status: "approved" | "rejected", reviewedBy: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE place_suggestions SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
    [id, status, reviewedBy],
  );
}
