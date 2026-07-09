import { refreshDerived } from "./recommend";
import { earnTokens, promotionReward } from "./economy";
import type { Dataset, EdgeType, GLink, GNode } from "./types";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** How many distinct users must assert a link before it becomes global. */
export const ENTITY_LINK_PROMOTION_THRESHOLD = 2;

export type EntityLinkType = "SAME_AS" | "RELATES_TO";

export interface EntityLinkPreset {
  id: string;
  type: EntityLinkType;
  label: string;
  description: string;
}

/** Presets for linking entities (same-as variants + semantic relations). */
export const ENTITY_LINK_PRESETS: EntityLinkPreset[] = [
  {
    id: "same_exact",
    type: "SAME_AS",
    label: "Same entity",
    description: "These names refer to the exact same thing",
  },
  {
    id: "same_translation",
    type: "SAME_AS",
    label: "Same · other language",
    description: "Equivalent across languages (e.g. English ↔ Persian)",
  },
  {
    id: "relates_related",
    type: "RELATES_TO",
    label: "Related to",
    description: "Loosely connected idea or topic",
  },
  {
    id: "relates_supports",
    type: "RELATES_TO",
    label: "Supports / evidence for",
    description: "One idea backs or strengthens the other",
  },
  {
    id: "relates_contradicts",
    type: "RELATES_TO",
    label: "Contradicts",
    description: "Tension or disagreement between ideas",
  },
  {
    id: "relates_prerequisite",
    type: "RELATES_TO",
    label: "Prerequisite of",
    description: "Understanding A helps understand B",
  },
];

const ENTITY_NODE_TYPES = new Set<GNode["type"]>([
  "concept",
  "thought",
  "book",
  "news",
  "music",
  "video",
  "movie",
  "location",
  "post",
  "financial_signal",
]);

function linkSignature(
  sourceId: string,
  targetId: string,
  type: EdgeType,
  label?: string,
): string {
  return `${pairKey(sourceId, targetId)}|${type}|${norm(label ?? "")}`;
}

function isEntityLink(l: GLink): boolean {
  return l.type === "SAME_AS" || l.type === "RELATES_TO";
}

/**
 * Links visible to a viewer: every global (shared/promoted) link plus the
 * viewer's own user-scoped links (friendships, reads, trust, entity links).
 * Another user's private edges are filtered out — this is the per-user overlay
 * boundary for the canvas payload.
 */
export function linksForViewer(d: Dataset, viewerId: string = d.meId): GLink[] {
  return d.links.filter((l) => {
    if (!l.scope || l.scope === "global") return true;
    if (l.scope === "user") return l.userId === viewerId;
    return false;
  });
}

/**
 * Project the shared union graph down to one viewer's canvas dataset: keep the
 * global catalog + only that viewer's personal edges, mark their root `isMe`,
 * and recompute derived state (sizes + recommendations) over that slice.
 *
 * This is the pure core behind graph-service's read/return payload. Mutations
 * still run over the full union (so consensus promotion + the trust fabric see
 * every user's edges); only what a viewer *reads back* is narrowed to here.
 */
export function viewForUser(d: Dataset, viewerId: string = d.meId): Dataset {
  const nodes = d.nodes.map((n) =>
    n.id === viewerId ? { ...n, isMe: true } : n.isMe ? { ...n, isMe: undefined } : n,
  );
  return refreshDerived({
    ...d,
    nodes,
    links: linksForViewer(d, viewerId),
    meId: viewerId,
  });
}

/** Entity-to-entity links touching a node (for Inspector). */
export function entityLinksForNode(d: Dataset, nodeId: string, viewerId: string = d.meId): GLink[] {
  return linksForViewer(d, viewerId).filter(
    (l) =>
      isEntityLink(l) &&
      (endId(l.source) === nodeId || endId(l.target) === nodeId),
  );
}

/** Linkable = an entity type, or a PUBLIC figure (extracted person), but not a
 *  social account (you / your friends). */
function isLinkableEntity(n: GNode): boolean {
  return ENTITY_NODE_TYPES.has(n.type) || (n.type === "person" && n.figure === true);
}

function assertEntityLinkPair(a: GNode, b: GNode): void {
  if (a.id === b.id) throw new Error("cannot link a node to itself");
  const social = (n: GNode) => n.type === "person" && !n.figure;
  if (social(a) || social(b))
    throw new Error("entity links connect ideas, content & public figures — not social accounts");
  if (!isLinkableEntity(a) || !isLinkableEntity(b))
    throw new Error(`cannot link ${a.type} ↔ ${b.type}`);
}

let linkSeq = 0;

/**
 * Add a user-scoped link between two entities. If another user already asserted
 * the same link, merge supporters and promote to global at the threshold.
 */
export function addUserEntityLink(
  d: Dataset,
  userId: string,
  sourceId: string,
  targetId: string,
  type: EntityLinkType,
  label?: string,
): Dataset {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const a = byId.get(sourceId);
  const b = byId.get(targetId);
  if (!a || !b) throw new Error("unknown node");
  assertEntityLinkPair(a, b);

  const sig = linkSignature(sourceId, targetId, type, label);
  const existing = d.links.find(
    (l) => isEntityLink(l) && linkSignature(endId(l.source), endId(l.target), l.type, l.label) === sig,
  );

  if (existing) {
    if (!existing.scope || existing.scope === "global") return refreshDerived(d);

    const supporters = [...new Set([...(existing.supporters ?? []), ...(existing.userId ? [existing.userId] : []), userId])];

    if (supporters.length >= ENTITY_LINK_PROMOTION_THRESHOLD) {
      const promoted: GLink = {
        ...existing,
        scope: "global",
        userId: undefined,
        supporters,
      };
      const next = refreshDerived({
        ...d,
        links: d.links.map((l) => (l.id === existing.id ? promoted : l)),
      });
      // Your link was admitted to the global graph — a contribution others
      // adopted. Reward scales with how many supporters it took.
      return earnTokens(
        next,
        promotionReward(supporters.length, ENTITY_LINK_PROMOTION_THRESHOLD),
        "promotion",
        existing.id,
      );
    }

    const updated: GLink = {
      ...existing,
      supporters,
      userId: existing.userId ?? userId,
    };
    return refreshDerived({
      ...d,
      links: d.links.map((l) => (l.id === existing.id ? updated : l)),
    });
  }

  const link: GLink = {
    id: `ul_${Date.now().toString(36)}${(linkSeq++ % 36).toString(36)}`,
    source: sourceId,
    target: targetId,
    type,
    label: label?.trim() || undefined,
    weight: 1,
    scope: "user",
    userId,
    supporters: [userId],
  };

  return refreshDerived({ ...d, links: [...d.links, link] });
}

/** Remove the viewer's assertion on a user-scoped entity link. */
export function removeUserEntityLink(d: Dataset, userId: string, linkId: string): Dataset {
  const link = d.links.find((l) => l.id === linkId);
  if (!link) return refreshDerived(d);
  if (!link.scope || link.scope === "global") throw new Error("cannot remove a global link");
  if (link.userId !== userId && !link.supporters?.includes(userId))
    throw new Error("not your link");

  const supporters = (link.supporters ?? (link.userId ? [link.userId] : [])).filter(
    (u) => u !== userId,
  );

  if (supporters.length === 0) {
    return refreshDerived({ ...d, links: d.links.filter((l) => l.id !== linkId) });
  }

  return refreshDerived({
    ...d,
    links: d.links.map((l) =>
      l.id === linkId
        ? { ...l, supporters, userId: l.userId === userId ? supporters[0] : l.userId }
        : l,
    ),
  });
}

export function entityLinkLabel(l: GLink): string {
  if (l.type === "SAME_AS") return l.label ?? "Same entity";
  return l.label ?? "Related to";
}

export function isUserScopedLink(l: GLink): boolean {
  return l.scope === "user";
}
