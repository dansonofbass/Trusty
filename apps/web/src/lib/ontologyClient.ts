/** Ontology entity creation — posts to the session-authed BFF entity route. */
import { setCustomOntology, type CustomOntology } from "@constellation/graph-core";

/**
 * Load the admin-defined ontology overlay and merge it into the browser's
 * graph-core registry, so custom Apps/entity types (e.g. the Sevan Summit) drive
 * the Add-Entity form, profiles, and directory exactly like the built-ins.
 */
export async function hydrateOntology(): Promise<CustomOntology> {
  const empty: CustomOntology = { apps: [], entityTypes: [], relations: [] };
  try {
    const r = await fetch("/api/ontology", { cache: "no-store" });
    const body = (await r.json().catch(() => null)) as CustomOntology | null;
    const overlay = body && Array.isArray(body.entityTypes) ? body : empty;
    setCustomOntology(overlay);
    return overlay;
  } catch {
    setCustomOntology(empty);
    return empty;
  }
}

export async function createEntity(input: {
  entityType: string;
  label: string;
  properties: Record<string, unknown>;
}): Promise<{ nodeId: string }> {
  const r = await fetch("/api/entity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `entity create failed (${r.status})`);
  return { nodeId: (body as { _entity?: { nodeId: string } })._entity?.nodeId ?? "" };
}
