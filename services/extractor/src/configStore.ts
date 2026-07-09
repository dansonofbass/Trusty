/**
 * Durable store for the admin-settable routing overrides.
 *
 * The extractor's routing (default provider/model, A/B split, override lock) is
 * driven by env defaults, which the admin panel can override at runtime. Those
 * overrides are persisted to Postgres so they survive restarts — following the
 * house pattern of `CREATE TABLE IF NOT EXISTS` on boot so existing databases
 * pick up the table without a re-init.
 *
 * With no DATABASE_URL the store degrades to in-memory (overrides last only for
 * the process lifetime) so local `npm run dev:extractor` still works.
 */
import pg from "pg";
import type { RoutingOverrides } from "./router";

const ROW_KEY = "routing";

export interface ConfigStore {
  /** The current overrides (env defaults apply for any unset field). */
  get(): RoutingOverrides;
  /** Merge a patch in, persist it, and return the new overrides. */
  set(patch: RoutingOverrides, updatedBy?: string): Promise<RoutingOverrides>;
  /** Where the config lives + last-write provenance, for the admin UI. */
  meta(): { persisted: boolean; updatedAt?: string; updatedBy?: string };
}

/** Drop undefined keys so a partial patch doesn't clobber unset fields. */
function clean(patch: RoutingOverrides): RoutingOverrides {
  const out: RoutingOverrides = {};
  if (patch.defaultKey !== undefined) out.defaultKey = patch.defaultKey;
  if (patch.abTest !== undefined) out.abTest = patch.abTest;
  if (patch.abSalt !== undefined) out.abSalt = patch.abSalt;
  if (patch.allowOverride !== undefined) out.allowOverride = patch.allowOverride;
  return out;
}

/** In-memory store — overrides last only for the process lifetime. */
function memoryStore(): ConfigStore {
  let current: RoutingOverrides = {};
  let updatedAt: string | undefined;
  let updatedBy: string | undefined;
  return {
    get: () => current,
    set: async (patch, by) => {
      current = { ...current, ...clean(patch) };
      updatedBy = by;
      updatedAt = new Date().toISOString();
      return current;
    },
    meta: () => ({ persisted: false, updatedAt, updatedBy }),
  };
}

export async function createConfigStore(databaseUrl?: string): Promise<ConfigStore> {
  if (!databaseUrl?.trim()) return memoryStore();

  let current: RoutingOverrides = {};
  let updatedAt: string | undefined;
  let updatedBy: string | undefined;

  let pool: pg.Pool;
  try {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS extractor_config (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const existing = await pool.query<{ value: RoutingOverrides; updated_by: string | null; updated_at: Date }>(
      `SELECT value, updated_by, updated_at FROM extractor_config WHERE key = $1`,
      [ROW_KEY],
    );
    if (existing.rows[0]) {
      current = existing.rows[0].value ?? {};
      updatedBy = existing.rows[0].updated_by ?? undefined;
      updatedAt = existing.rows[0].updated_at?.toISOString?.();
    }
  } catch (e) {
    console.warn(
      "extractor: Postgres unavailable, routing overrides will be in-memory only:",
      e instanceof Error ? e.message : e,
    );
    return memoryStore();
  }

  return {
    get: () => current,
    set: async (patch, by) => {
      const next = { ...current, ...clean(patch) };
      const r = await pool.query<{ updated_at: Date }>(
        `INSERT INTO extractor_config (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()
         RETURNING updated_at`,
        [ROW_KEY, next, by ?? null],
      );
      current = next; // only commit in-memory after the write succeeds
      updatedBy = by;
      updatedAt = r.rows[0]?.updated_at?.toISOString?.();
      return current;
    },
    meta: () => ({ persisted: true, updatedAt, updatedBy }),
  };
}
