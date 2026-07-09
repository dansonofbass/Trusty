/**
 * Runtime ontology registry — the ontology is DATA, not a compile-time const.
 *
 * The code-defined built-ins (restaurants, doctors, …) form the "general" app and
 * are registered once at init via `registerBuiltins`. Admins define additional
 * **Apps** (each App = a Space = a URL namespace) with their own entity types and
 * relations; that overlay is loaded from the store (service, at boot/on change) or
 * fetched by the browser (client, from `GET /api/ontology`) and installed with
 * `setCustomOntology`. All ontology lookups read the MERGED view, so a custom
 * entity type behaves identically to a built-in one (same create/validate/trust).
 *
 * Merge-overlay keeps the existing app untouched while making new apps fully
 * admin-authored (the Sevan Summit app lives entirely in the store).
 */
import type { Dataset, GLink, GNode } from "./types";
// Type-only import (erased at runtime) — no import cycle with ./ontology, which
// registers its built-ins into this module at init.
import type { EntityTypeDef, RelationDef } from "./ontology";

/** An App = a Space = a URL namespace that owns entity types + relations. */
export interface AppDef {
  slug: string;
  label: string;
  order?: number;
  builtin?: boolean;
  /** Admin-managed app config (e.g. noteKinds: the note-extraction taxonomy). */
  config?: Record<string, unknown>;
}

/** The admin-defined overlay (everything not baked into code). */
export interface CustomOntology {
  apps: AppDef[];
  entityTypes: EntityTypeDef[];
  relations: RelationDef[];
}

/** Slug of the built-in app that holds the code-seeded entity types. */
export const BUILTIN_APP = "general";
const BUILTIN_APP_DEF: AppDef = { slug: BUILTIN_APP, label: "Trusty", order: 0, builtin: true };

let builtinTypes: EntityTypeDef[] = [];
let builtinRelations: RelationDef[] = [];
let custom: CustomOntology = { apps: [], entityTypes: [], relations: [] };

/** The app a type belongs to (built-ins default to the general app). */
export function appOf(t: EntityTypeDef): string {
  return t.app ?? BUILTIN_APP;
}

/** Called once by ./ontology at module init with the code-defined built-ins. */
export function registerBuiltins(types: EntityTypeDef[], relations: RelationDef[]): void {
  builtinTypes = types;
  builtinRelations = relations;
}

/** Install/replace the admin-defined overlay. Idempotent; safe to call repeatedly. */
export function setCustomOntology(o: Partial<CustomOntology> | null | undefined): void {
  custom = {
    apps: o?.apps ?? [],
    entityTypes: o?.entityTypes ?? [],
    relations: o?.relations ?? [],
  };
}

/** The admin-defined overlay alone (what a client hydrates into its own registry). */
export function getCustomOntology(): CustomOntology {
  return custom;
}

/* ---- merged reads ------------------------------------------------- */

export function allEntityTypes(): EntityTypeDef[] {
  return [...builtinTypes, ...custom.entityTypes];
}

export function allRelations(): RelationDef[] {
  return [...builtinRelations, ...custom.relations];
}

export function allApps(): AppDef[] {
  return [BUILTIN_APP_DEF, ...[...custom.apps].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))];
}

export function appBySlug(slug: string): AppDef | undefined {
  return allApps().find((a) => a.slug === slug);
}

/** The full effective ontology (for `GET /api/ontology` + client hydration). */
export function getOntology(): { apps: AppDef[]; entityTypes: EntityTypeDef[]; relations: RelationDef[] } {
  return { apps: allApps(), entityTypes: allEntityTypes(), relations: allRelations() };
}

/** Custom overrides a built-in on id collision. */
export function entityTypeById(id: string): EntityTypeDef | undefined {
  return custom.entityTypes.find((t) => t.id === id) ?? builtinTypes.find((t) => t.id === id);
}

export function appForEntityType(id: string): string | undefined {
  const t = entityTypeById(id);
  return t ? appOf(t) : undefined;
}

export function topicForEntityType(id: string): string | undefined {
  return entityTypeById(id)?.topic;
}

export function entityTypesForApp(slug: string): EntityTypeDef[] {
  return allEntityTypes().filter((t) => appOf(t) === slug);
}

export function relationsForApp(slug: string): RelationDef[] {
  return allRelations().filter((r) => (r.app ?? BUILTIN_APP) === slug);
}

/* ---- app-scoped layering ----------------------------------------- */

/**
 * Project a dataset down to one App's Space: keep the SHARED person layer + any
 * non-ontology nodes, plus entities that belong to `appSlug`; drop other apps'
 * entities and any link left dangling. Persons are common to every app so real
 * people met in one app can be reached in another. Pure (no derived recompute) —
 * the caller (graph-service `viewFor`) refreshes.
 */
export function scopeToApp(d: Dataset, appSlug: string): Dataset {
  const keep = (n: GNode): boolean =>
    n.type === "person" || !n.entityType || appForEntityType(n.entityType) === appSlug;
  const nodes = d.nodes.filter(keep);
  const ids = new Set(nodes.map((n) => n.id));
  const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
  const links = d.links.filter((l: GLink) => ids.has(endId(l.source)) && ids.has(endId(l.target)));
  return { ...d, nodes, links };
}
