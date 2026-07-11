/**
 * Admin People & Entities manager client — list/edit/delete every node
 * (persons + ontology entities) separable by app, plus bulk import/export.
 */
import type { FieldDef } from "@constellation/graph-core";

export interface EntityRow {
  id: string;
  label: string;
  sub?: string;
  type: string;
  entityType?: string;
  app?: string | null;
  isMe: boolean;
  properties: Record<string, unknown>;
  photos: string[];
}

export interface SchemaType {
  id: string;
  label: string;
  app: string;
  baseType: string;
  category?: string | null;
  fields: FieldDef[];
}

export interface EntitiesSchema {
  apps: { slug: string; label: string }[];
  entityTypes: SchemaType[];
}

async function j<T>(r: Response, what: string): Promise<T> {
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `${what} failed (${r.status})`);
  return b as T;
}

export async function entitiesSchema(): Promise<EntitiesSchema> {
  return j(await fetch("/api/admin/entities/schema", { cache: "no-store" }), "schema");
}

export async function listEntities(opts: { app?: string; type?: string; q?: string }): Promise<{ total: number; nodes: EntityRow[] }> {
  const qs = new URLSearchParams();
  if (opts.app) qs.set("app", opts.app);
  if (opts.type) qs.set("type", opts.type);
  if (opts.q) qs.set("q", opts.q);
  return j(await fetch(`/api/admin/entities?${qs}`, { cache: "no-store" }), "list");
}

export async function updateEntityAdmin(id: string, patch: { label?: string; properties?: Record<string, unknown> }): Promise<void> {
  await j(await fetch(`/api/admin/entities/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
  }), "update");
}

export async function deleteEntityAdmin(id: string): Promise<void> {
  await j(await fetch(`/api/admin/entities/${encodeURIComponent(id)}`, { method: "DELETE" }), "delete");
}

export async function createEntityAdmin(input: { entityType: string; label: string; properties?: Record<string, unknown> }): Promise<string> {
  const r = await fetch("/api/entity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const b = await j<{ _entity?: { nodeId?: string } }>(r, "create");
  return String(b._entity?.nodeId ?? "");
}

export interface ImportRow { entityType: string; label: string; properties?: Record<string, unknown> }

export async function exportEntities(opts: { app?: string; type?: string }): Promise<ImportRow[]> {
  const qs = new URLSearchParams();
  if (opts.app) qs.set("app", opts.app);
  if (opts.type) qs.set("type", opts.type);
  const b = await j<{ rows?: ImportRow[] }>(await fetch(`/api/admin/entities/export?${qs}`, { cache: "no-store" }), "export");
  return b.rows ?? [];
}

export async function importEntities(rows: ImportRow[]): Promise<{ created: number; errors: { label: string; error: string }[] }> {
  return j(await fetch("/api/admin/entities/import", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }),
  }), "import");
}

/* --- relations --- */

export interface NodeRelation {
  edgeId: string;
  relationId: string;
  label: string;
  direction: "out" | "in";
  otherId: string;
  otherLabel: string;
  otherType?: string;
  ontology?: boolean; // true = an admin-defined ontology relation (vs a core edge)
}
export interface AvailableRelation {
  relationId: string;
  label: string;
  direction: "out" | "in";
  otherTypes: string[];
}

export async function nodeRelations(id: string): Promise<{ relations: NodeRelation[]; available: AvailableRelation[] }> {
  return j(await fetch(`/api/admin/entities/${encodeURIComponent(id)}/relations`, { cache: "no-store" }), "relations");
}

export async function addRelation(input: { relationId: string; source: string; target: string }): Promise<void> {
  await j(await fetch("/api/admin/relations", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }), "add relation");
}

export async function removeRelation(edgeId: string): Promise<void> {
  await j(await fetch(`/api/admin/relations/${encodeURIComponent(edgeId)}`, { method: "DELETE" }), "remove relation");
}
