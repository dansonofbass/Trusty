/** Admin ontology builder — CRUD over Apps / Entity Types / Relations via the BFF. */
import type { AppDef, EntityTypeDef, FieldDef, RelationDef } from "@constellation/graph-core";

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body as T;
}

export async function listApps(): Promise<{ apps: AppDef[]; enabled: boolean }> {
  return json(await fetch("/api/admin/apps", { cache: "no-store" }));
}

export async function saveApp(input: {
  slug: string;
  label: string;
  order?: number;
  /** Merged over the app's existing config server-side. */
  config?: Record<string, unknown>;
}): Promise<AppDef> {
  return json(
    await fetch("/api/admin/apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteApp(slug: string): Promise<void> {
  await json(await fetch(`/api/admin/apps/${encodeURIComponent(slug)}`, { method: "DELETE" }));
}

export async function saveEntityType(
  app: string,
  input: { id: string; label: string; baseType: string; topic: string; category?: string; fields: FieldDef[]; order?: number },
): Promise<EntityTypeDef> {
  return json(
    await fetch(`/api/admin/apps/${encodeURIComponent(app)}/entity-types`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteEntityType(app: string, id: string): Promise<void> {
  await json(
    await fetch(`/api/admin/apps/${encodeURIComponent(app)}/entity-types/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

export async function saveRelation(
  app: string,
  input: { id: string; label: string; from: string[]; to: string[] },
): Promise<RelationDef> {
  return json(
    await fetch(`/api/admin/apps/${encodeURIComponent(app)}/relations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteRelation(app: string, id: string): Promise<void> {
  await json(
    await fetch(`/api/admin/apps/${encodeURIComponent(app)}/relations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/* Event locations (meeting venues) — admin-managed per app. */
export interface AdminLocation {
  id: string;
  app: string;
  label: string;
  ord: number;
}

export async function listLocationsAdmin(app: string): Promise<AdminLocation[]> {
  const r = await json<{ locations: AdminLocation[] }>(
    await fetch(`/api/locations?app=${encodeURIComponent(app)}`, { cache: "no-store" }),
  );
  return r.locations ?? [];
}

export async function saveLocation(app: string, label: string, ord?: number): Promise<AdminLocation> {
  return json(
    await fetch("/api/admin/locations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app, label, ord }),
    }),
  );
}

export async function deleteLocationAdmin(id: string): Promise<void> {
  await json(await fetch(`/api/admin/locations/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export interface ImportRow {
  entityType: string;
  label: string;
  properties?: Record<string, unknown>;
}

export async function importEntities(rows: ImportRow[]): Promise<{ created: number; errors: { label: string; error: string }[] }> {
  return json(
    await fetch("/api/admin/summit/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    }),
  );
}

/**
 * Parse pasted JSON or CSV into import rows.
 * CSV: header row `entityType,label,<field>…`; multiselect values use `|`.
 */
export function parseImport(text: string, typeIds: string[]): ImportRow[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    const parsed = JSON.parse(t);
    return (Array.isArray(parsed) ? parsed : [parsed]) as ImportRow[];
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const iType = header.findIndex((h) => h.toLowerCase() === "entitytype" || h.toLowerCase() === "type");
  const iLabel = header.findIndex((h) => ["label", "name"].includes(h.toLowerCase()));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const entityType = iType >= 0 ? cells[iType] : typeIds[0] ?? "";
    const label = iLabel >= 0 ? cells[iLabel] : cells[0] ?? "";
    const properties: Record<string, unknown> = {};
    header.forEach((h, i) => {
      if (i === iType || i === iLabel || !cells[i]) return;
      properties[h] = cells[i].includes("|") ? cells[i].split("|").map((s) => s.trim()) : cells[i];
    });
    return { entityType, label, properties };
  });
}
