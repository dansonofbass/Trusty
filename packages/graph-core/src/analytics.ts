import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import { bidirectional } from "graphology-shortest-path";
import { mulberry32 } from "./random";
import { CommunityInfo, GLink, GNode } from "./types";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** Build an undirected graphology graph from the dataset (deduped). */
export function toGraph(nodes: GNode[], links: GLink[]): UndirectedGraph {
  const g = new UndirectedGraph({ allowSelfLoops: false });
  for (const n of nodes) g.addNode(n.id, { type: n.type, label: n.label });
  for (const l of links) {
    // Trust edges are directed + scoped; they don't belong in the undirected
    // social/visibility/community model. The Trust Engine builds its own adjacency.
    if (l.type === "TRUSTS") continue;
    const s = endId(l.source);
    const t = endId(l.target);
    if (s === t || !g.hasNode(s) || !g.hasNode(t)) continue;
    g.mergeEdge(s, t, { type: l.type, weight: l.weight });
  }
  return g;
}

/**
 * Louvain communities over the whole graph — people cluster together WITH the
 * content they share, which is exactly what a "circle of friends" looks like
 * in this product. Deterministic via seeded rng.
 */
export function computeCommunities(
  g: UndirectedGraph,
  nodes: GNode[],
  seed = 7,
): { byNode: Record<string, number>; infos: CommunityInfo[] } {
  const raw = louvain(g, { rng: mulberry32(seed), getEdgeWeight: "weight" }) as Record<string, number>;

  // Re-index communities by size (0 = largest) for stable colors & legend order.
  const sizes = new Map<number, string[]>();
  for (const [id, c] of Object.entries(raw)) {
    if (!sizes.has(c)) sizes.set(c, []);
    sizes.get(c)!.push(id);
  }
  const ordered = [...sizes.entries()].sort((a, b) => b[1].length - a[1].length);
  const remap = new Map(ordered.map(([orig], i) => [orig, i]));
  const byNode: Record<string, number> = {};
  for (const [id, c] of Object.entries(raw)) byNode[id] = remap.get(c)!;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const infos: CommunityInfo[] = ordered.map(([, memberIds], i) => {
    // Name each circle after its best-connected person.
    let topPerson: { label: string; deg: number } | null = null;
    for (const id of memberIds) {
      const n = nodeById.get(id);
      if (!n || n.type !== "person" || n.isMe) continue;
      const deg = g.degree(id);
      if (!topPerson || deg > topPerson.deg) topPerson = { label: n.label, deg };
    }
    const hasMe = memberIds.includes("me");
    const label = hasMe
      ? "Your inner circle"
      : topPerson
        ? `${topPerson.label}'s circle`
        : "Drifting cluster";
    return { id: i, label, size: memberIds.length, memberIds, color: "" };
  });

  return { byNode, infos };
}

/** Unweighted shortest path between two nodes (or null). */
export function shortestPath(g: UndirectedGraph, a: string, b: string): string[] | null {
  if (!g.hasNode(a) || !g.hasNode(b)) return null;
  return bidirectional(g, a, b);
}

/** BFS neighborhood of a node up to `depth` hops (includes the node itself). */
export function egoIds(g: UndirectedGraph, id: string, depth = 2): Set<string> {
  const seen = new Set<string>([id]);
  if (!g.hasNode(id)) return seen;
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      g.forEachNeighbor(cur, (nbr) => {
        if (!seen.has(nbr)) {
          seen.add(nbr);
          next.push(nbr);
        }
      });
    }
    frontier = next;
  }
  return seen;
}

/** A paid, ephemeral peek into a region centered on `center`. */
export interface PeekRegion {
  center: string;
  radius: number;
}

export interface VisibilityOpts {
  /** Ego radius around the viewer (default 2). */
  radius?: number;
  /**
   * Ego radius around each social merge (default 1). Smaller than `radius` so
   * befriending pulls in a friend's *immediate* neighborhood, not their whole
   * multi-hop sphere — otherwise a few well-connected friends unbound the galaxy
   * in a dense graph.
   */
  followRadius?: number;
  /** People you're socially connected to — their neighborhoods fold into yours. */
  follows?: Iterable<string>;
  /** Active token-bought peeks (temporary). */
  peeks?: Iterable<PeekRegion>;
}

/**
 * The bounded universe a viewer can currently see: the union of ego bubbles
 * around themselves, each social merge (a befriended person pulls their own
 * neighborhood in), and each active peek. This is the whole visibility model —
 * everything else is the whole graph the viewer must EARN their way into.
 *
 * Pure + deterministic; reuses `egoIds` so it stays one BFS per center.
 */
export function visibleIds(
  g: UndirectedGraph,
  meId: string,
  opts: VisibilityOpts = {},
): Set<string> {
  const radius = opts.radius ?? 2;
  const followRadius = opts.followRadius ?? 1;
  const out = egoIds(g, meId, radius);
  for (const f of opts.follows ?? []) for (const id of egoIds(g, f, followRadius)) out.add(id);
  for (const p of opts.peeks ?? []) for (const id of egoIds(g, p.center, p.radius)) out.add(id);
  return out;
}

/** Ids both endpoints connect to — the "shared lens" between you and a friend. */
export function commonNeighborIds(g: UndirectedGraph, a: string, b: string): string[] {
  if (!g.hasNode(a) || !g.hasNode(b)) return [];
  const setA = new Set(g.neighbors(a));
  return g.neighbors(b).filter((id) => setA.has(id) && id !== a && id !== b);
}
