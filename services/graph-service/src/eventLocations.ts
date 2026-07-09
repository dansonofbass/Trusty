/**
 * Event locations (venues) — admin-defined meeting spots per App ("Pitch tent",
 * "Lakeside", …). Meeting requests offer these as a picker, with a free-text
 * fallback for anything not listed. Mirrors asks.ts / meetings.ts: no-op
 * without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function locationsEnabled(): boolean {
  return !!pool;
}

export async function initEventLocations(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — event locations disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS event_locations (
      id          BIGSERIAL PRIMARY KEY,
      app         TEXT NOT NULL DEFAULT 'summit',
      label       TEXT NOT NULL,
      ord         INT  NOT NULL DEFAULT 10,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (app, label)
    )`);
  pool = p;
  console.log("graph-service: event locations ready (postgres)");
}

export interface EventLocation {
  id: string;
  app: string;
  label: string;
  ord: number;
}

function row(r: Record<string, unknown>): EventLocation {
  return { id: String(r.id), app: String(r.app), label: String(r.label), ord: Number(r.ord) };
}

export async function listLocations(app: string): Promise<EventLocation[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM event_locations WHERE app=$1 ORDER BY ord, label`, [app]);
  return r.rows.map(row);
}

export async function upsertLocation(input: { app: string; label: string; ord?: number }): Promise<EventLocation> {
  if (!pool) throw new Error("event locations disabled");
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new Error("location needs a label");
  const r = await pool.query(
    `INSERT INTO event_locations (app, label, ord) VALUES ($1,$2,$3)
     ON CONFLICT (app, label) DO UPDATE SET ord = EXCLUDED.ord
     RETURNING *`,
    [input.app, label, Number.isFinite(input.ord) ? Number(input.ord) : 10],
  );
  return row(r.rows[0]);
}

export async function deleteLocation(id: string): Promise<void> {
  if (!pool) throw new Error("event locations disabled");
  await pool.query(`DELETE FROM event_locations WHERE id=$1`, [id]);
}
