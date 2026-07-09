/**
 * Ontology store — the admin-defined multi-app ontology (Apps / Entity Types /
 * Relations) persisted in Postgres. Code-defined built-ins stay in graph-core (the
 * "general" app); this store holds only the CUSTOM overlay that admins author in
 * the builder (e.g. the whole Sevan Summit app). `loadOntology()` feeds
 * graph-core's `setCustomOntology`, so a stored entity type behaves exactly like a
 * built-in one (same create / validate / trust path).
 *
 * Mirrors asks.ts / invites.ts: no-op without DATABASE_URL, tables created lazily.
 */
import pg from "pg";
import type { AppDef, CustomOntology, EntityTypeDef, FieldDef, RelationDef } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function ontologyEnabled(): boolean {
  return !!pool;
}

export async function initOntology(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — ontology store disabled (built-ins only)");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS ontology_apps (
      slug        TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      ord         INT  NOT NULL DEFAULT 10,
      config      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`ALTER TABLE ontology_apps ADD COLUMN IF NOT EXISTS config JSONB`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ontology_entity_types (
      app         TEXT NOT NULL REFERENCES ontology_apps(slug) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      label       TEXT NOT NULL,
      base_type   TEXT NOT NULL,
      topic       TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '',
      fields      JSONB NOT NULL DEFAULT '[]',
      ord         INT  NOT NULL DEFAULT 10,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (app, id)
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ontology_relations (
      app         TEXT NOT NULL REFERENCES ontology_apps(slug) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      label       TEXT NOT NULL,
      from_types  JSONB NOT NULL DEFAULT '[]',
      to_types    JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (app, id)
    )`);
  pool = p;
  console.log("graph-service: ontology store ready (postgres)");
}

const FIELD_TYPES = new Set(["text", "number", "money", "boolean", "select", "multiselect", "geo"]);
const BASE_TYPES = new Set(["person", "location"]);
const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Coerce arbitrary admin input into a clean FieldDef[]. */
function cleanFields(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldDef[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    const key = slugify(String(r.key ?? r.label ?? ""));
    const type = String(r.type ?? "text");
    if (!key || !FIELD_TYPES.has(type)) continue;
    const def: FieldDef = { key, label: String(r.label ?? key), type: type as FieldDef["type"] };
    if ((type === "select" || type === "multiselect") && Array.isArray(r.options)) {
      def.options = r.options.map((o) => slugify(String(o))).filter(Boolean);
    }
    if (r.unit) def.unit = String(r.unit);
    if (r.placeholder) def.placeholder = String(r.placeholder);
    out.push(def);
  }
  return out;
}

/* ------------------------------- reads ----------------------------- */

/** The full custom overlay (feeds graph-core `setCustomOntology`). */
export async function loadOntology(): Promise<CustomOntology> {
  if (!pool) return { apps: [], entityTypes: [], relations: [] };
  const [apps, types, rels] = await Promise.all([
    pool.query(`SELECT slug, label, ord, config FROM ontology_apps ORDER BY ord, slug`),
    pool.query(`SELECT app, id, label, base_type, topic, category, fields FROM ontology_entity_types ORDER BY ord, id`),
    pool.query(`SELECT app, id, label, from_types, to_types FROM ontology_relations ORDER BY id`),
  ]);
  return {
    apps: apps.rows.map((r): AppDef => ({ slug: r.slug, label: r.label, order: r.ord, config: r.config ?? undefined })),
    entityTypes: types.rows.map(
      (r): EntityTypeDef => ({
        app: r.app,
        id: r.id,
        label: r.label,
        baseType: r.base_type,
        topic: r.topic,
        domain: r.category || r.app,
        fields: Array.isArray(r.fields) ? (r.fields as FieldDef[]) : [],
      }),
    ),
    relations: rels.rows.map(
      (r): RelationDef => ({
        app: r.app,
        id: r.id,
        label: r.label,
        from: Array.isArray(r.from_types) ? r.from_types : [],
        to: Array.isArray(r.to_types) ? r.to_types : [],
      }),
    ),
  };
}

/* ------------------------------- apps ------------------------------ */

export async function listApps(): Promise<AppDef[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT slug, label, ord, config FROM ontology_apps ORDER BY ord, slug`);
  return r.rows.map((x) => ({ slug: x.slug, label: x.label, order: x.ord, config: x.config ?? undefined }));
}

export async function upsertApp(input: {
  slug: string;
  label: string;
  order?: number;
  /** Merged over the existing config (pass a key with null to clear it). */
  config?: Record<string, unknown>;
}): Promise<AppDef> {
  if (!pool) throw new Error("ontology store disabled");
  const slug = slugify(input.slug || input.label);
  if (!slug) throw new Error("app needs a slug");
  if (slug === "general") throw new Error('"general" is the built-in app');
  const label = input.label.trim() || slug;
  const ord = Number.isFinite(input.order) ? Number(input.order) : 10;
  const r = await pool.query(
    `INSERT INTO ontology_apps (slug, label, ord, config) VALUES ($1,$2,$3,$4)
     ON CONFLICT (slug) DO UPDATE SET
       label = EXCLUDED.label, ord = EXCLUDED.ord,
       config = COALESCE(ontology_apps.config, '{}'::jsonb) || COALESCE(EXCLUDED.config, '{}'::jsonb)
     RETURNING config`,
    [slug, label, ord, input.config ? JSON.stringify(input.config) : null],
  );
  return { slug, label, order: ord, config: r.rows[0]?.config ?? undefined };
}

export async function deleteApp(slug: string): Promise<void> {
  if (!pool) throw new Error("ontology store disabled");
  await pool.query(`DELETE FROM ontology_apps WHERE slug = $1`, [slug]);
}

/* --------------------------- entity types -------------------------- */

export async function upsertEntityType(
  app: string,
  input: { id: string; label: string; baseType: string; topic: string; category?: string; fields?: unknown; order?: number },
): Promise<EntityTypeDef> {
  if (!pool) throw new Error("ontology store disabled");
  const id = slugify(input.id || input.label);
  if (!id) throw new Error("entity type needs an id");
  const baseType = BASE_TYPES.has(input.baseType) ? input.baseType : "person";
  const topic = slugify(input.topic || id);
  const category = slugify(input.category || "") || app;
  const fields = cleanFields(input.fields);
  const ord = Number.isFinite(input.order) ? Number(input.order) : 10;
  await pool.query(
    `INSERT INTO ontology_entity_types (app, id, label, base_type, topic, category, fields, ord)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (app, id) DO UPDATE SET
       label=EXCLUDED.label, base_type=EXCLUDED.base_type, topic=EXCLUDED.topic,
       category=EXCLUDED.category, fields=EXCLUDED.fields, ord=EXCLUDED.ord`,
    [app, id, input.label.trim() || id, baseType, topic, category, JSON.stringify(fields), ord],
  );
  return { app, id, label: input.label.trim() || id, baseType: baseType as EntityTypeDef["baseType"], topic, domain: category, fields };
}

export async function deleteEntityType(app: string, id: string): Promise<void> {
  if (!pool) throw new Error("ontology store disabled");
  await pool.query(`DELETE FROM ontology_entity_types WHERE app=$1 AND id=$2`, [app, id]);
}

/* ----------------------------- relations --------------------------- */

export async function upsertRelation(
  app: string,
  input: { id: string; label: string; from?: unknown; to?: unknown },
): Promise<RelationDef> {
  if (!pool) throw new Error("ontology store disabled");
  const id = slugify(input.id || input.label);
  if (!id) throw new Error("relation needs an id");
  const from = Array.isArray(input.from) ? input.from.map(String) : ["*"];
  const to = Array.isArray(input.to) ? input.to.map(String) : ["*"];
  await pool.query(
    `INSERT INTO ontology_relations (app, id, label, from_types, to_types)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (app, id) DO UPDATE SET label=EXCLUDED.label, from_types=EXCLUDED.from_types, to_types=EXCLUDED.to_types`,
    [app, id, input.label.trim() || id, JSON.stringify(from), JSON.stringify(to)],
  );
  return { app, id, label: input.label.trim() || id, from, to };
}

export async function deleteRelation(app: string, id: string): Promise<void> {
  if (!pool) throw new Error("ontology store disabled");
  await pool.query(`DELETE FROM ontology_relations WHERE app=$1 AND id=$2`, [app, id]);
}
