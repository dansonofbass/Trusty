/**
 * Runtime platform settings (admin-toggleable) — tiny key/value store.
 * First consumer: open_access ("1" = no waitlist; the summit default).
 * The OPEN_ACCESS env var still force-opens regardless of the setting.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;
const cache = new Map<string, string>();

export async function initSettings(): Promise<void> {
  if (!DATABASE_URL) return;
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  pool = p;
  const r = await p.query(`SELECT key, value FROM app_settings`);
  for (const row of r.rows) cache.set(String(row.key), String(row.value));
  console.log("graph-service: settings ready (postgres)");
}

export function getSetting(key: string, fallback: string): string {
  return cache.get(key) ?? fallback;
}

export async function setSetting(key: string, value: string, updatedBy: string): Promise<void> {
  cache.set(key, value);
  if (!pool) return;
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
    [key, value, updatedBy],
  );
}

/** Open access = no waitlist. Env force-open wins; else the admin toggle
 *  (DEFAULT OPEN — squads are the connection mechanism at the summit). */
export function openAccessEnabled(): boolean {
  if (process.env.OPEN_ACCESS === "1") return true;
  return getSetting("open_access", "1") !== "0";
}
