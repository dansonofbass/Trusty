import { Dataset, GLink, GNode, Recommendation } from "./types";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

const PAST_VERB: Record<string, string> = {
  READS: "read",
  LISTENS_TO: "listen to",
  WATCHES: "watched",
  FOLLOWS: "follow",
  LIKES: "liked",
  POSTED: "posted",
  TRACKS: "track",
  VISITED: "visited",
};

/**
 * Precomputed per-node signal maps, injected by the caller (graph-service /
 * recommender read them from Postgres/communities). The pure engine never does
 * I/O — same pattern as the trust engine's `TrustQuery.expandedTopics`. All maps
 * are optional; a missing map ⇒ that channel contributes 0.
 */
export interface SignalMaps {
  /** node → content/embedding similarity, [0,1] (reserved; unused until the embedding tier). */
  embeddingAffinity?: Map<string, number>;
  /** node → the viewer's topic affinity from search/interaction history, [0,1]. */
  topicAffinity?: Map<string, number>;
  /** node → 1 if in the viewer's Louvain community, else 0. */
  communityBoost?: Map<string, number>;
  /** node → feedback/outcome signal, [-1,1] (signed). */
  outcomeSignal?: Map<string, number>;
  /**
   * node → topic-scoped DERIVED reputation for that node's own topic, [-1,1]
   * (signed). Independent of trust and of the viewer's relationship — historical
   * provider reliability only (Doc #10). Populated by the reputation service.
   */
  reputation?: Map<string, number>;
  /** node → recency-decayed seen/dismiss penalty, [0,1] (subtractive). */
  fatigue?: Map<string, number>;
}

/** Blend weights — all env-overridable at the service layer. */
export interface BlendWeights {
  struct?: number;
  topic?: number;
  community?: number;
  embed?: number;
  outcome?: number;
  reputation?: number;
  fatigue?: number;
}

export const DEFAULT_WEIGHTS: Required<BlendWeights> = {
  struct: 0.55,
  topic: 0.28,
  community: 0.17,
  embed: 0, // reserved for the future content-embedding tier
  outcome: 0.3, // == TRUST_W_OUTCOME so social + trust recs share a scale
  reputation: 0.3, // topic-scoped provider reliability (independent of outcome/trust)
  fatigue: 0.25,
};

export interface RecommendOptions {
  /** Node ids the user dismissed — never recommended again. */
  dismissed?: string[];
  contentLimit?: number; // default 10
  peopleLimit?: number; // default 3
  /**
   * Personalization signals. ABSENT ⇒ the legacy pure structural scoring runs
   * byte-for-byte (mock mode / snapshot tests unaffected). PRESENT ⇒ each rec is
   * re-scored by the normalized blend and re-ranked, keeping its structural
   * `via`/because-path (a node with no structural path is never emitted).
   */
  signals?: SignalMaps;
  weights?: BlendWeights;
}

/** Saturating [0,1] normalization of a raw structural weight (order-preserving). */
const saturate = (raw: number, k: number): number => 1 - Math.exp(-raw / k);
const K_CONTENT = 1.5;
const K_PEOPLE = 2;

/**
 * Explainable friend-overlap recommendations.
 *
 * The contract that defines the product: every suggestion MUST carry the
 * `via` friends it travelled through, so the frontend can draw the
 * because-path as a visible line in the sky. No path → no recommendation.
 *
 * This single function runs everywhere:
 *  - seed world construction (build time)
 *  - the in-browser mock client (after every user action)
 *  - graph-service (after every mutation in api mode)
 *  - the recommender service (Phase 3 swaps the internals — pgvector +
 *    BGE-M3 embeddings, personalized PageRank — behind this signature)
 */
export function computeRecommendations(
  nodes: GNode[],
  links: GLink[],
  meId: string,
  opts: RecommendOptions = {},
): Recommendation[] {
  const dismissed = new Set(opts.dismissed ?? []);
  const contentLimit = opts.contentLimit ?? 10;
  const peopleLimit = opts.peopleLimit ?? 3;

  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const neighborSets = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!neighborSets.has(a)) neighborSets.set(a, new Set());
    neighborSets.get(a)!.add(b);
  };
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    touch(s, t);
    touch(t, s);
  }

  const myNbrs = neighborSets.get(meId) ?? new Set<string>();
  const friends = [...myNbrs].filter((id) => idToNode.get(id)?.type === "person");

  // Interest similarity me↔friend = shared non-person neighbors.
  const sharedInterests = (friendId: string): number => {
    const f = neighborSets.get(friendId) ?? new Set<string>();
    let n = 0;
    for (const x of f)
      if (x !== meId && myNbrs.has(x) && idToNode.get(x)?.type !== "person") n++;
    return n;
  };
  const friendWeight = new Map(friends.map((f) => [f, sharedInterests(f)]));
  const friendSet = new Set(friends);

  const recs: Recommendation[] = [];
  // Normalized structural strength per candidate (for the blend). Populated as
  // recs are built so the blend can combine it with the injected signal maps.
  const structOf = new Map<string, number>();

  /* ---- content frontier: connected to ≥1 friend, not to me ---------- */
  const candidateScores = new Map<string, { score: number; via: Map<string, number> }>();
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    // friend → content can be stored in either orientation
    const pairs: Array<[string, string]> = [
      [s, t],
      [t, s],
    ];
    for (const [f, c] of pairs) {
      if (!friendSet.has(f)) continue;
      if (c === meId || myNbrs.has(c) || dismissed.has(c)) continue;
      const node = idToNode.get(c);
      if (!node || node.type === "person") continue;
      const w = 0.6 + (friendWeight.get(f) ?? 0) * 0.25;
      const entry = candidateScores.get(c) ?? { score: 0, via: new Map() };
      entry.score += w;
      entry.via.set(f, (entry.via.get(f) ?? 0) + w);
      candidateScores.set(c, entry);
    }
  }
  const topContent = [...candidateScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, contentLimit);
  for (const [nodeId, { score, via }] of topContent) {
    const viaSorted = [...via.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const top = viaSorted.slice(0, 2);
    const names = top.map((id) => idToNode.get(id)!.label);
    const verbEdge = links.find((l) => {
      const s = endId(l.source);
      const t = endId(l.target);
      return (t === nodeId && top.includes(s)) || (s === nodeId && top.includes(t));
    });
    const verb = PAST_VERB[verbEdge?.type ?? "LIKES"] ?? "liked";
    const k = Math.max(...top.map((id) => friendWeight.get(id) ?? 0));
    const who = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
    structOf.set(nodeId, saturate(score, K_CONTENT));
    recs.push({
      nodeId,
      score: Math.round(score * 10) / 10,
      via: top,
      reason: `${who} ${verb} this — ${names[0]} shares ${k} interest${k === 1 ? "" : "s"} with you.`,
    });
  }

  /* ---- people frontier: friends-of-friends by mutuals --------------- */
  const fofMutuals = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type !== "person" || n.id === meId) continue;
    if (myNbrs.has(n.id) || dismissed.has(n.id)) continue;
    const mutuals = [...(neighborSets.get(n.id) ?? [])].filter(
      (id) => friendSet.has(id),
    );
    if (mutuals.length) fofMutuals.set(n.id, mutuals);
  }
  const topPeople = [...fofMutuals.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, peopleLimit);
  for (const [nodeId, mutuals] of topPeople) {
    const names = mutuals.slice(0, 2).map((id) => idToNode.get(id)!.label);
    structOf.set(nodeId, saturate(mutuals.length, K_PEOPLE));
    recs.push({
      nodeId,
      score: mutuals.length,
      via: mutuals.slice(0, 2),
      reason: `${mutuals.length} mutual friend${mutuals.length > 1 ? "s" : ""} — closest through ${names.join(" and ")}.`,
    });
  }

  // Signals absent ⇒ legacy path: sort by the raw structural score, unchanged.
  if (!opts.signals) {
    recs.sort((a, b) => b.score - a.score);
    return recs;
  }

  // Signals present ⇒ blend each rec's normalized structural strength with the
  // injected personalization channels, then re-rank. `via`/because-path is left
  // intact — provenance stays structural, only the ranking changes.
  applyBlend(recs, structOf, opts.signals, { ...DEFAULT_WEIGHTS, ...opts.weights });
  recs.sort((a, b) => b.score - a.score);
  return recs;
}

const CHANNEL_PHRASE: Record<string, string> = {
  topic: "In line with what you've been looking for",
  community: "Popular in your circle",
  outcome: "Backed by good outcomes",
  reputation: "Strong track record on this topic",
  embed: "Similar to things you like",
};

/** Re-score recs in place with the normalized blend + attach factor breakdown. */
function applyBlend(
  recs: Recommendation[],
  structOf: Map<string, number>,
  s: SignalMaps,
  w: Required<BlendWeights>,
): void {
  for (const rec of recs) {
    const struct = structOf.get(rec.nodeId) ?? 0;
    const topic = s.topicAffinity?.get(rec.nodeId) ?? 0;
    const community = s.communityBoost?.get(rec.nodeId) ?? 0;
    const embed = s.embeddingAffinity?.get(rec.nodeId) ?? 0;
    const outcome = s.outcomeSignal?.get(rec.nodeId) ?? 0;
    const reputation = s.reputation?.get(rec.nodeId) ?? 0;
    const fatigue = s.fatigue?.get(rec.nodeId) ?? 0;

    const base = w.struct * struct + w.topic * topic + w.community * community + w.embed * embed;
    // outcome + reputation are independent signed modifiers on the structural base.
    const blended = base * (1 + w.outcome * outcome + w.reputation * reputation) - w.fatigue * fatigue;
    rec.score = Math.round(blended * 1000) / 1000;

    const factors = [
      { channel: "struct", contribution: w.struct * struct },
      { channel: "topic", contribution: w.topic * topic },
      { channel: "community", contribution: w.community * community },
      { channel: "embed", contribution: w.embed * embed },
      { channel: "outcome", contribution: w.outcome * outcome * base },
      { channel: "reputation", contribution: w.reputation * reputation * base },
      { channel: "fatigue", contribution: -w.fatigue * fatigue },
    ]
      .filter((f) => Math.abs(f.contribution) > 0.001)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    rec.factors = factors;

    // Compose the reason: lead with the top NON-structural channel when it's a
    // meaningful contributor, keeping the structural because-path after it.
    const topNon = factors.find((f) => f.channel !== "struct" && f.contribution > 0.02);
    if (topNon && CHANNEL_PHRASE[topNon.channel]) {
      rec.reason = `${CHANNEL_PHRASE[topNon.channel]} — ${rec.reason}`;
    }
  }
}

/** Degree-based size hints — shared by seed + mutations so sizes stay honest. */
export function recomputeVals(nodes: GNode[], links: GLink[]): void {
  const degree = new Map<string, number>();
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
  }
  for (const n of nodes) {
    const d = degree.get(n.id) ?? 1;
    n.val = n.isMe ? 22 : n.type === "person" ? 6 + Math.min(8, d * 0.45) : 2.6 + Math.min(5, d * 0.55);
  }
}

/** Convenience: recompute vals + recommendations on a dataset in one pass. */
export function refreshDerived(d: Dataset): Dataset {
  recomputeVals(d.nodes, d.links);
  return {
    ...d,
    recommendations: computeRecommendations(d.nodes, d.links, d.meId, {
      dismissed: d.dismissed,
    }),
  };
}
