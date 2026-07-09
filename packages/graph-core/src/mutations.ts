import { Dataset, EDGE_VERB_FOR_TYPE, EdgeType, GLink, GNode, NodeType } from "./types";
import { refreshDerived } from "./recommend";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The user action vocabulary, as pure functions on a Dataset.
 * Every action IS a graph mutation — that's the product's whole metaphor.
 *
 *   befriend            → addEdge(me, person)        FRIENDS_WITH
 *   add to my sky       → addEdge(me, content)       READS/WATCHES/…
 *   unfriend / remove   → removeEdge(me, x)
 *   post                → createPost(me, text)       node + POSTED
 *   accept a rec        → acceptRecommendation       ghost edge solidifies
 *   dismiss a rec       → dismissRecommendation      never shown again
 *
 * Node objects are kept by reference (only `val` is updated in place) so the
 * force simulation never loses positions. Recommendations are recomputed
 * after every action — the frontier reacts live to what you do.
 */

/** Which edge connects these two nodes? null = not a legal pair. */
export function inferEdgeType(a: GNode, b: GNode): EdgeType | null {
  if (a.type === "person" && b.type === "person") return "FRIENDS_WITH";
  if (a.type === "person" && b.type !== "person")
    return EDGE_VERB_FOR_TYPE[b.type as Exclude<NodeType, "person">];
  if (b.type === "person" && a.type !== "person")
    return EDGE_VERB_FOR_TYPE[a.type as Exclude<NodeType, "person">];
  return null; // content↔content edges are derived, not user actions
}

/** Does an edge already connect this pair, visible to (owned by) `owner`? */
function hasOwnedEdgeBetween(
  links: GLink[],
  a: string,
  b: string,
  owner?: string,
): boolean {
  const k = pairKey(a, b);
  return links.some((l) => {
    if (pairKey(endId(l.source), endId(l.target)) !== k) return false;
    // A global edge blocks re-adds for everyone; a user edge only for its owner.
    if (!l.scope || l.scope === "global") return true;
    return l.userId === owner;
  });
}

/**
 * Add a personal relationship edge (FRIENDS_WITH / READS / WATCHES / …).
 *
 * `owner` is the user this edge belongs to. When set, the edge is stamped
 * `scope:"user"` + `userId` so it lives in that user's private overlay and is
 * filtered out of every other viewer's canvas (see `linksForViewer`). Left
 * undefined (seed world, connector ingestion) the edge is a shared/global fact.
 */
export function addEdge(
  d: Dataset,
  sourceId: string,
  targetId: string,
  owner?: string,
): Dataset {
  if (sourceId === targetId) throw new Error("cannot connect a node to itself");
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const a = byId.get(sourceId);
  const b = byId.get(targetId);
  if (!a || !b) throw new Error("unknown node");
  const type = inferEdgeType(a, b);
  if (!type) throw new Error(`no edge type connects ${a.type} ↔ ${b.type}`);
  // Ownership is per (pair, owner): the same viewer can't double-add, but two
  // different users independently asserting the same pair each keep their own
  // private edge (and are candidates for consensus promotion elsewhere).
  if (hasOwnedEdgeBetween(d.links, sourceId, targetId, owner)) return refreshDerived(d);

  // Orient person → content for readability; FRIENDS_WITH is symmetric.
  const [s, t] = a.type === "person" ? [a, b] : [b, a];
  const link: GLink = {
    id: owner ? `ux_${owner}__${pairKey(s.id, t.id)}` : `ux_${pairKey(s.id, t.id)}`,
    source: s.id,
    target: t.id,
    type,
    weight: 1,
    ...(owner ? { scope: "user" as const, userId: owner } : {}),
  };
  return refreshDerived({ ...d, links: [...d.links, link] });
}

/**
 * Remove a personal edge between a pair. With `owner` set, only the caller's own
 * edge is removed — you can un-read your own book, never a shared/global fact or
 * another user's private edge. (Legacy un-owned edges touching the owner are
 * still removable, so pre-scope data can be cleaned up.)
 */
/**
 * Connect two real users as friends — the invite/accept bridge (Phase 2).
 *
 * A friendship between two people must be visible on BOTH of their canvases, but
 * personal edges are private per-owner (Phase 1). So a mutual friendship is a
 * MIRRORED pair: `a→b` owned by `a` and `b→a` owned by `b`. Each user sees the
 * connection in their own overlay; the trust fabric (which reads the union and
 * treats FRIENDS_WITH as undirected) sees a single bridge. Idempotent.
 */
export function addMutualFriendship(d: Dataset, aId: string, bId: string): Dataset {
  if (aId === bId) throw new Error("cannot befriend yourself");
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const a = byId.get(aId);
  const b = byId.get(bId);
  if (!a || !b) throw new Error("unknown node");
  if (a.type !== "person" || b.type !== "person")
    throw new Error("friendships connect people");
  // addEdge is idempotent per (pair, owner), so re-accepting is a no-op.
  return addEdge(addEdge(d, aId, bId, aId), bId, aId, bId);
}

export function removeEdge(d: Dataset, a: string, b: string, owner?: string): Dataset {
  const k = pairKey(a, b);
  const removable = (l: GLink): boolean => {
    if (pairKey(endId(l.source), endId(l.target)) !== k) return false;
    if (!owner) return true;
    if (l.scope === "user") return l.userId === owner;
    // legacy un-owned edge — only if the owner is one of its endpoints
    return endId(l.source) === owner || endId(l.target) === owner;
  };
  const links = d.links.filter((l) => !removable(l));
  if (links.length === d.links.length) return refreshDerived(d);
  return refreshDerived({ ...d, links });
}

let postSeq = 0;
export function createPost(d: Dataset, authorId: string, label: string): Dataset {
  const author = d.nodes.find((n) => n.id === authorId);
  if (!author || author.type !== "person") throw new Error("author must be a person");
  const text = label.trim().slice(0, 140);
  if (!text) throw new Error("empty post");
  const id = `tu_${Date.now().toString(36)}${(postSeq++ % 36).toString(36)}`;
  const node: GNode = {
    id,
    type: "post",
    label: text,
    sub: `${author.isMe ? "You" : author.label} · just now`,
    clusters: author.clusters.slice(0, 2),
  };
  const link: GLink = {
    id: `ux_posted_${id}`,
    source: authorId,
    target: id,
    type: "POSTED",
    weight: 1,
  };
  return refreshDerived({ ...d, nodes: [...d.nodes, node], links: [...d.links, link] });
}

/** The signature move: the dashed gold ghost edge solidifies into a real one. */
export function acceptRecommendation(d: Dataset, nodeId: string): Dataset {
  if (!d.recommendations.some((r) => r.nodeId === nodeId))
    throw new Error("not currently recommended");
  // Accepting a rec is a personal action — the new edge is the viewer's own.
  return addEdge(d, d.meId, nodeId, d.meId); // refreshDerived drops it from the frontier
}

export function dismissRecommendation(d: Dataset, nodeId: string): Dataset {
  const dismissed = [...new Set([...(d.dismissed ?? []), nodeId])];
  return refreshDerived({ ...d, dismissed });
}
