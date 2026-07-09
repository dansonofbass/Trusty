/**
 * Event relationship graph (Trusty Sevan) — materialize profile tags as SHARED
 * concept nodes + typed edges (the "hybrid" model): tags stay on the profile for
 * fast match scoring AND become one shared node per tag ("React", "FinTech") so
 * the canvas shows who clusters around what, and "same tech / same interest"
 * becomes a first-class graph signal.
 *
 * Density is bounded by the curated vocabulary: ONLY values that appear in the
 * field's admin-defined `options` list materialize — free-text stays tags-only.
 *
 * Reconciliation is deterministic: edge ids are `tag_<owner>_<EDGE>_<slug>`, so
 * re-saving a profile diffs desired-vs-existing (add missing, drop stale) and
 * never duplicates or orphans. Pure + deterministic (caller passes `now`).
 */
import type { Dataset, EdgeType, GLink, GNode } from "./types";
import { entityTypeById } from "./ontologyRegistry";
import { activeRolesOf } from "./ontology";

/** Profile field key → the relationship its tags materialize as. */
const TAG_EDGE: Record<string, EdgeType> = {
  technologies: "USES",
  interests: "INTERESTED_IN",
  sectors: "INTERESTED_IN",
  industries: "INTERESTED_IN",
  needs: "NEEDS",
  skills_needed: "NEEDS",
  offers: "OFFERS",
  apis: "OFFERS",
  skills_offered: "OFFERS",
};

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** Shared concept-node id for a tag. One node per tag across the whole event. */
export const tagConceptId = (slug: string) => `cn_t_${slug}`;

/**
 * Sync a node's tag edges with its current properties. Returns a new Dataset
 * (or the same object when nothing changed). Safe to call for ANY entity — a
 * node with no mapped tag fields is a no-op (restaurants etc. pass through).
 */
export function materializeTags(d: Dataset, ownerId: string): Dataset {
  const owner = d.nodes.find((n) => n.id === ownerId);
  if (!owner || !owner.entityType) return d;
  // Multi-role persons: fields come from the UNION of active roles' schemas
  // (deduped by key — shared fragments appear once).
  const defs = activeRolesOf(owner)
    .map((r) => entityTypeById(r))
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (defs.length === 0) return d;
  const fields = new Map<string, (typeof defs)[number]["fields"][number]>();
  for (const def of defs) for (const f of def.fields) if (!fields.has(f.key)) fields.set(f.key, f);

  // Desired (edgeType, tag-slug) pairs — curated options only.
  const desired = new Map<string, { edge: EdgeType; slug: string; label: string }>();
  for (const f of fields.values()) {
    const edge = TAG_EDGE[f.key];
    if (!edge || !f.options?.length) continue; // unmapped or free-text field → tags-only
    const raw = owner.properties?.[f.key];
    const values = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
    for (const v of values) {
      const slug = slugify(v);
      if (!slug || !f.options.includes(v)) continue;
      desired.set(`tag_${ownerId}_${edge}_${slug}`, { edge, slug, label: titleCase(v) });
    }
  }

  const prefix = `tag_${ownerId}_`;
  const existing = d.links.filter((l) => l.id.startsWith(prefix));
  const existingIds = new Set(existing.map((l) => l.id));
  const staleIds = new Set(existing.filter((l) => !desired.has(l.id)).map((l) => l.id));
  const toAdd = [...desired.entries()].filter(([id]) => !existingIds.has(id));
  if (staleIds.size === 0 && toAdd.length === 0) return d;

  // Ensure a shared concept node per newly needed tag.
  const nodes = [...d.nodes];
  const byId = new Set(nodes.map((n) => n.id));
  for (const [, t] of toAdd) {
    const cid = tagConceptId(t.slug);
    if (!byId.has(cid)) {
      byId.add(cid);
      nodes.push({ id: cid, type: "concept", label: t.label, sub: "shared at the event", clusters: [], val: 3 });
    }
  }

  let links = d.links.filter((l) => !staleIds.has(l.id));
  for (const [id, t] of toAdd) {
    links.push({ id, source: ownerId, target: tagConceptId(t.slug), type: t.edge, weight: 1 });
  }

  // Prune tag-concepts nothing links to anymore (keeps the sky clean).
  const referenced = new Set(links.flatMap((l: GLink) => [endId(l.source), endId(l.target)]));
  const pruned = nodes.filter((n) => !n.id.startsWith("cn_t_") || referenced.has(n.id));

  return { ...d, nodes: pruned, links };
}
