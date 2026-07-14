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
}

export const LISTEN_DEFAULTS: ListenCapacityConfig = {
  baseSlots: 5,
  contributionPerSlot: 5,
  maxSlots: 50,
};

/**
 * How many people this account may listen to, given its contribution score.
 * Monotonic, saturating, and NEVER influenced by payment or profile vanity —
 * only by meaningful participation (recommendations authored, outcomes reported).
 */
export function listenCapacity(
  contributionScore: number,
  cfg: Partial<ListenCapacityConfig> = {},
): number {
  const c = { ...LISTEN_DEFAULTS, ...cfg };
  const earned = Math.floor(Math.max(0, contributionScore) / Math.max(1, c.contributionPerSlot));
  return Math.min(c.maxSlots, c.baseSlots + earned);
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
