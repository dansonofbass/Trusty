/**
 * Listen — the recommendation-permission relationship (Doc #6/#7).
 *
 * Trusty deliberately has NO "Follow". Listening is a *recommendation
 * preference*, not a social tie: it tells the engine "when this person
 * contributes knowledge in the future, consider it when generating
 * recommendations for me". The spec freezes these properties:
 *
 *   - **Never trust.** Listening never creates trust, never raises reputation,
 *     never changes a trust score. This is guaranteed *structurally*: the trust
 *     engine's adjacency (trust.ts `buildAdj`) only ever follows TRUSTS and
 *     FRIENDS_WITH, so a LISTENS_TO_PERSON edge cannot carry trust even in
 *     principle.
 *   - **Directional.** Alice listening to Bob does NOT make Bob listen to Alice.
 *   - **Permission-based.** The edge exists only after the target accepts; the
 *     pending request lives outside the graph (graph-service `listen.ts`).
 *   - **A limited resource.** Each account has a bounded number of active listen
 *     slots. Capacity is EARNED through contribution — never bought (#7:
 *     "Listen capacity increases through meaningful participation rather than
 *     payment"). Contribution unlocks *opportunity*, never trustworthiness.
 *
 * Naming: the spec calls the edge LISTENS_TO, but that is already the taste-graph
 * verb (person → music), so the permission edge is LISTENS_TO_PERSON.
 *
 * Pure + deterministic — no I/O, no clock.
 */
import type { Dataset, GLink, GNode } from "./types";
import { refreshDerived } from "./recommend";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/* ------------------------------ capacity ------------------------------ */

export interface ListenCapacityConfig {
  /** Slots every account starts with. */
  baseSlots: number;
  /** Contribution points needed to earn one additional slot. */
  contributionPerSlot: number;
  /** Hard ceiling on total slots. */
  maxSlots: number;
  /**
   * Tenure growth (#23 "weekly capacity growth"): one extra slot per this many
   * weeks of membership — capacity grows slowly just for remaining a member,
   * INDEPENDENTLY of contribution. 0 disables tenure growth.
   */
  weeksPerSlot: number;
  /** Cap on tenure-earned slots (so tenure alone never dominates). */
  maxTenureSlots: number;
}

export const LISTEN_DEFAULTS: ListenCapacityConfig = {
  baseSlots: 5,
  contributionPerSlot: 5,
  maxSlots: 50,
  weeksPerSlot: 4,
  maxTenureSlots: 10,
};

/**
 * How many people this account may listen to. Two independent growth
 * mechanisms (#23): meaningful contribution (primary) and long-term
 * membership tenure (slow, capped). Monotonic, saturating, and NEVER
 * influenced by payment, follower counts or profile vanity. Future capacity
 * pools (topic/professional/org) = new config fields, not a redesign.
 */
export function listenCapacity(
  contributionScore: number,
  cfg: Partial<ListenCapacityConfig> = {},
  tenureWeeks = 0,
): number {
  const c = { ...LISTEN_DEFAULTS, ...cfg };
  const earned = Math.floor(Math.max(0, contributionScore) / Math.max(1, c.contributionPerSlot));
  const tenure =
    c.weeksPerSlot > 0
      ? Math.min(c.maxTenureSlots, Math.floor(Math.max(0, tenureWeeks) / c.weeksPerSlot))
      : 0;
  return Math.min(c.maxSlots, c.baseSlots + earned + tenure);
}

/* ------------------------------- queries ------------------------------ */

/** People this user listens to (outgoing). */
export function listeningTo(d: Dataset, listenerId: string): string[] {
  return d.links
    .filter((l) => l.type === "LISTENS_TO_PERSON" && endId(l.source) === listenerId)
    .map((l) => endId(l.target));
}

/** People who listen to this user (incoming) — their audience. */
export function listenersOf(d: Dataset, targetId: string): string[] {
  return d.links
    .filter((l) => l.type === "LISTENS_TO_PERSON" && endId(l.target) === targetId)
    .map((l) => endId(l.source));
}

/** Active slots in use (how many people I currently listen to). */
export function activeListenCount(d: Dataset, listenerId: string): number {
  return listeningTo(d, listenerId).length;
}

export function isListening(d: Dataset, listenerId: string, targetId: string): boolean {
  return listeningTo(d, listenerId).includes(targetId);
}

/* ------------------------------ mutations ----------------------------- */

/**
 * Create the accepted Listen edge (listener → speaker). Call this ONLY after the
 * target has accepted the request. Enforces the slot budget: a listener at
 * capacity cannot open another. Idempotent, directional, never reciprocal.
 */
export function addListenEdge(
  d: Dataset,
  listenerId: string,
  targetId: string,
  capacity: number,
): Dataset {
  if (listenerId === targetId) throw new Error("cannot listen to yourself");
  const listener = d.nodes.find((n) => n.id === listenerId);
  const target = d.nodes.find((n) => n.id === targetId);
  if (!listener || !target) throw new Error("unknown node");
  if (listener.type !== "person" || target.type !== "person")
    throw new Error("listening connects people");
  if (isListening(d, listenerId, targetId)) return refreshDerived(d); // idempotent
  if (activeListenCount(d, listenerId) >= capacity)
    throw new Error("listen capacity reached — earn more slots by contributing");

  const link: GLink = {
    id: `ux_listen_${listenerId}__${targetId}`,
    source: listenerId,
    target: targetId,
    type: "LISTENS_TO_PERSON",
    weight: 1,
    scope: "user",
    userId: listenerId,
  };
  return refreshDerived({ ...d, links: [...d.links, link] });
}

/** Stop listening — frees the slot. Only the listener can remove their own edge. */
export function removeListenEdge(d: Dataset, listenerId: string, targetId: string): Dataset {
  const links = d.links.filter(
    (l) =>
      !(
        l.type === "LISTENS_TO_PERSON" &&
        endId(l.source) === listenerId &&
        endId(l.target) === targetId
      ),
  );
  if (links.length === d.links.length) return refreshDerived(d);
  return refreshDerived({ ...d, links });
}

/* ----------------------------- suggestions ----------------------------- */

export interface ListenSuggestion {
  personId: string;
  /** Blended relevance in [0,1] — never popularity. */
  score: number;
  /** Every suggestion is explainable (#23) — one phrase per contributing signal. */
  reasons: string[];
}

export interface ListenSuggestOptions {
  /** Contribution Engine score per person (0 when unknown) — quality signal. */
  contributionOf?: (id: string) => number;
  /** Relationship strength per person in [0,1] (0 when unknown). */
  strengthOf?: (id: string) => number;
  limit?: number;
}

/** Topics a person is *about*: recs they authored + topics others trust them on. */
function topicsOf(d: Dataset, personId: string): Set<string> {
  const topics = new Set<string>();
  for (const n of d.nodes) {
    if (n.type !== "recommendation") continue;
    const p = n.properties as { authorId?: string; topic?: string } | undefined;
    if (p?.authorId === personId && p.topic) topics.add(p.topic);
  }
  for (const l of d.links) {
    if (l.type === "TRUSTS" && endId(l.target) === personId && l.trust?.scope.topic)
      topics.add(l.trust.scope.topic);
  }
  return topics;
}

/**
 * Who should this viewer listen to, when free capacity exists (#23)?
 * Signals: topic overlap, trust-of-trust proximity, contribution quality and
 * relationship strength — each contributing an EXPLAINABLE reason. Deliberately
 * absent: follower/listener counts, popularity, payment (#23 "artificial
 * network expansion provides no meaningful advantage"). Pure + deterministic;
 * AI/services may hydrate the signal callbacks but never inject candidates.
 */
export function listenSuggestions(
  d: Dataset,
  viewerId: string,
  opts: ListenSuggestOptions = {},
): ListenSuggestion[] {
  const limit = opts.limit ?? 10;
  const already = new Set(listeningTo(d, viewerId));

  // Viewer interest topics: their profile interests + topics they trust on.
  const interests = new Set<string>();
  const me = d.nodes.find((n) => n.id === viewerId);
  const meProps = (me?.properties ?? {}) as { known_topics?: string[]; looking_for?: string };
  for (const t of meProps.known_topics ?? []) interests.add(String(t).toLowerCase());
  if (meProps.looking_for) interests.add(String(meProps.looking_for).toLowerCase());
  for (const l of d.links) {
    if (l.type === "TRUSTS" && endId(l.source) === viewerId && l.trust?.scope.topic)
      interests.add(l.trust.scope.topic);
  }

  // Trust-of-trust: people trusted by the people I trust (2nd hop, direct only).
  const iTrust = new Set(
    d.links.filter((l) => l.type === "TRUSTS" && endId(l.source) === viewerId).map((l) => endId(l.target)),
  );
  const trustedByMyNetwork = new Set(
    d.links
      .filter((l) => l.type === "TRUSTS" && iTrust.has(endId(l.source)))
      .map((l) => endId(l.target)),
  );

  const out: ListenSuggestion[] = [];
  for (const n of d.nodes) {
    if (n.type !== "person" || n.id === viewerId || already.has(n.id)) continue;
    let score = 0;
    const reasons: string[] = [];

    const shared = [...topicsOf(d, n.id)].filter((t) => interests.has(t));
    if (shared.length > 0) {
      score += 0.3 * Math.min(1, shared.length / 2);
      reasons.push(`Knows the topics you care about: ${shared.slice(0, 3).join(", ")}`);
    }
    if (trustedByMyNetwork.has(n.id) && !iTrust.has(n.id)) {
      score += 0.35;
      reasons.push("Trusted by people you already trust");
    }
    const contribution = opts.contributionOf?.(n.id) ?? 0;
    if (contribution > 0) {
      score += 0.25 * Math.min(1, contribution / 20);
      reasons.push("Consistently improves the network's knowledge");
    }
    const strength = opts.strengthOf?.(n.id) ?? 0;
    if (strength > 0.3) {
      score += 0.15 * Math.min(1, strength);
      reasons.push("You already interact regularly");
    }

    if (score > 0) out.push({ personId: n.id, score: Math.round(score * 1000) / 1000, reasons });
  }

  return out
    .sort((a, b) => b.score - a.score || a.personId.localeCompare(b.personId))
    .slice(0, limit);
}

/* ---------------------------- what it unlocks -------------------------- */

/**
 * The whole point of Listening: recommendation nodes authored by the people this
 * viewer listens to become ELIGIBLE candidates for them. Returns those
 * recommendation nodes (optionally narrowed to a topic) — ranking, reputation
 * and quality are applied downstream by the ranking pipeline. Listening only
 * makes knowledge *visible*; it never makes it *trusted*.
 */
export function recommendationsFromListened(
  d: Dataset,
  viewerId: string,
  topic?: string,
): GNode[] {
  const speakers = new Set(listeningTo(d, viewerId));
  if (speakers.size === 0) return [];
  return d.nodes.filter((n) => {
    if (n.type !== "recommendation") return false;
    const p = n.properties as { authorId?: string; topic?: string } | undefined;
    if (!p?.authorId || !speakers.has(p.authorId)) return false;
    if (topic && p.topic !== topic) return false;
    return true;
  });
}
