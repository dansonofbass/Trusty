/**
 * Trust Graph — the MVP core (Doc §1–12).
 *
 * Trust is a *directed, topic-scoped relationship* (truster → trustee/provider),
 * never a global user attribute. Trust Scores are NEVER stored — they're computed
 * per search by transferring trust along in-scope paths with distance decay.
 *
 * V1 is deliberately simple: topic matching is **equality** (topic + optional geo),
 * not weighted similarity or vectors (those are explicitly out of scope). The
 * runtime score combines just the three signals the doc names: Personal Trust
 * Path + Topic Trust + Outcome.
 */
import { refreshDerived } from "./recommend";
import type {
  Dataset,
  GLink,
  GNode,
  Recommendation,
  TrustEdgeProps,
  TrustPathHop,
  TrustScope,
} from "./types";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

/* ------------------------------------------------------------------ */
/* Taxonomies (Doc §4 Topic Taxonomy, §11 Reason Taxonomy) — curated,  */
/* expandable by admins without architecture changes.                  */
/* ------------------------------------------------------------------ */

/** Seed topics. Keys are canonical codes; admins extend this list over time. */
export const TOPIC_TAXONOMY: string[] = [
  "food",
  "restaurant",
  "cafe",
  "doctor",
  "dentist",
  "lawyer",
  "broker",
  "real_estate",
  "immigration",
  "mechanic",
  "electrician",
  "plumber",
  "accountant",
  "shopping",
  "travel",
  "fitness",
  "technology",
  "music",
  "entertainment",
];

/** Optional hierarchy — a child topic also matches a query for its parent. */
export const TOPIC_PARENT: Record<string, string> = {
  restaurant: "food",
  cafe: "food",
};

/** Synonyms / NL phrases → canonical topic, for resolution + validation. */
const TOPIC_SYNONYMS: Record<string, string> = {
  realtor: "broker",
  "real estate agent": "broker",
  "real estate": "real_estate",
  apartment: "real_estate",
  rent: "real_estate",
  renting: "real_estate",
  coffee: "cafe",
  "coffee shop": "cafe",
  physician: "doctor",
  attorney: "lawyer",
  gym: "fitness",
  car: "mechanic",
  tech: "technology",
};

/** Predefined reason codes per topic (Doc §11 — no free-text reasons in V1).
 *  Every taxonomy topic has specific codes so "Why do you trust them?" adapts
 *  to the field; universal codes are appended for all. */
export const REASON_TAXONOMY: Record<string, string[]> = {
  broker: ["honest", "fair_price", "responsive", "professional", "good_negotiation", "market_knowledge"],
  real_estate: ["honest", "fair_price", "responsive", "professional", "market_knowledge", "knows_the_area"],
  doctor: ["accurate", "professional", "explains_well", "caring", "clean"],
  dentist: ["accurate", "professional", "explains_well", "caring", "clean"],
  restaurant: ["food_quality", "service", "price", "atmosphere", "cleanliness"],
  cafe: ["food_quality", "service", "price", "atmosphere", "cleanliness"],
  food: ["food_quality", "service", "price", "atmosphere", "cleanliness"],
  lawyer: ["knowledgeable", "won_my_case", "clear_fees", "well_connected", "explains_well"],
  immigration: ["knowledgeable", "successful_cases", "clear_fees", "up_to_date", "patient"],
  mechanic: ["quality_work", "fair_price", "fast", "honest_diagnosis", "warranty"],
  electrician: ["quality_work", "fair_price", "fast", "safe_work", "tidy"],
  plumber: ["quality_work", "fair_price", "fast", "emergency_available", "tidy"],
  accountant: ["accurate", "knows_tax_law", "fair_price", "proactive", "discreet"],
  shopping: ["good_selection", "fair_price", "quality_goods", "helpful_staff", "easy_returns"],
  travel: ["well_organized", "fair_price", "great_itineraries", "handles_problems"],
  fitness: ["motivating", "knowledgeable", "real_results", "safe_technique", "punctual"],
  technology: ["skilled", "delivers_on_time", "communicates_well", "fair_price", "maintains_after"],
  music: ["great_taste", "talented", "reads_the_crowd", "punctual"],
  entertainment: ["great_taste", "fun", "well_organized", "family_friendly"],
};

/** Universal reasons available for any topic. */
export const UNIVERSAL_REASONS = ["honest", "reliable", "responsive", "professional"];

/** Reason codes valid for a topic (topic-specific ∪ universal). */
export function reasonsForTopic(topic: string): string[] {
  const t = norm(topic);
  return [...new Set([...(REASON_TAXONOMY[t] ?? []), ...UNIVERSAL_REASONS])];
}

/** Normalize a raw topic string to a canonical taxonomy code (best effort). */
export function normalizeTopic(raw: string | undefined): string {
  if (!raw) return "";
  const n = norm(raw);
  if (TOPIC_TAXONOMY.includes(n)) return n;
  const spaced = raw.trim().toLowerCase();
  if (TOPIC_SYNONYMS[spaced]) return TOPIC_SYNONYMS[spaced];
  if (TOPIC_SYNONYMS[n]) return TOPIC_SYNONYMS[n];
  return n; // keep unknown topic as-is (flagged by callers if needed)
}

/** Snap a raw scope to canonical form + drop reasons that aren't in the taxonomy. */
export function validateScope(raw: Partial<TrustScope>): TrustScope {
  return {
    topic: normalizeTopic(raw.topic),
    entity: raw.entity ? norm(raw.entity) : undefined,
    context: raw.context ? norm(raw.context) : undefined,
    preferences: raw.preferences?.map((p) => norm(p)),
    geo: raw.geo ? norm(raw.geo) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Trust edge mutations (mirror entityLinks.ts)                        */
/* ------------------------------------------------------------------ */

let trustSeq = 0;

/** Does a stored trust edge already exist for (from, to, topic)? */
function findTrustEdge(d: Dataset, fromId: string, toId: string, topic: string): GLink | undefined {
  return d.links.find(
    (l) =>
      l.type === "TRUSTS" &&
      endId(l.source) === fromId &&
      endId(l.target) === toId &&
      l.trust?.scope.topic === topic,
  );
}

/**
 * Create (or update) a directed trust edge `fromId → toId` on a topic scope.
 * Updating the same (from,to,topic) raises interactionCount + refreshes fields.
 */
export function addTrustEdge(
  d: Dataset,
  fromId: string,
  toId: string,
  scope: TrustScope,
  opts: {
    confidence?: number;
    reasons?: string[];
    source?: "explicit" | "extracted";
    evidence?: string[];
    /** Free-text note ("great for date night") — surfaced on the detail panel. */
    note?: string;
    now: number; // pass a timestamp in (graph-core stays deterministic)
  },
): Dataset {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const a = byId.get(fromId);
  const b = byId.get(toId);
  if (!a || !b) throw new Error("unknown node");
  if (fromId === toId) throw new Error("cannot trust yourself");

  const clean = validateScope(scope);
  if (!clean.topic) throw new Error("trust requires a topic");
  const allowed = new Set(reasonsForTopic(clean.topic));
  const reasons = (opts.reasons ?? []).map(norm).filter((r) => allowed.has(r));
  const confidence = Math.max(0, Math.min(1, opts.confidence ?? 0.7));

  const existing = findTrustEdge(d, fromId, toId, clean.topic);
  if (existing && existing.trust) {
    const trust: TrustEdgeProps = {
      ...existing.trust,
      scope: clean,
      confidence,
      reasons: [...new Set([...existing.trust.reasons, ...reasons])],
      source: opts.source ?? existing.trust.source,
      interactionCount: (existing.trust.interactionCount ?? 1) + 1,
      lastUpdate: opts.now,
      evidence: opts.evidence
        ? [...new Set([...(existing.trust.evidence ?? []), ...opts.evidence])]
        : existing.trust.evidence,
      note: opts.note?.trim() ? opts.note.trim() : existing.trust.note,
    };
    return refreshDerived({
      ...d,
      links: d.links.map((l) => (l.id === existing.id ? { ...l, weight: confidence, trust } : l)),
    });
  }

  const trust: TrustEdgeProps = {
    scope: clean,
    confidence,
    reasons,
    source: opts.source ?? "explicit",
    outcome: 0,
    interactionCount: 1,
    createdAt: opts.now,
    lastUpdate: opts.now,
    evidence: opts.evidence,
    note: opts.note?.trim() || undefined,
  };
  const link: GLink = {
    id: `tr_${opts.now.toString(36)}${(trustSeq++ % 36).toString(36)}`,
    source: fromId,
    target: toId,
    type: "TRUSTS",
    weight: confidence,
    scope: "user",
    userId: fromId,
    trust,
  };
  return refreshDerived({ ...d, links: [...d.links, link] });
}

/** Remove a trust edge the user owns. */
export function removeTrustEdge(d: Dataset, userId: string, linkId: string): Dataset {
  const link = d.links.find((l) => l.id === linkId);
  if (!link) return refreshDerived(d);
  if (link.type !== "TRUSTS") throw new Error("not a trust edge");
  if (endId(link.source) !== userId) throw new Error("not your trust edge");
  return refreshDerived({ ...d, links: d.links.filter((l) => l.id !== linkId) });
}

/** Trust edges the viewer authored that touch a node (for the Inspector). */
export function trustEdgesForNode(d: Dataset, nodeId: string, viewerId: string): GLink[] {
  return d.links.filter(
    (l) =>
      l.type === "TRUSTS" &&
      endId(l.source) === viewerId &&
      (endId(l.source) === nodeId || endId(l.target) === nodeId),
  );
}

/** Record an outcome on a trust edge (rolling mean in [-1,1]). Returns dataset. */
export function applyOutcomeToEdge(d: Dataset, edgeId: string, value: number, now: number): Dataset {
  return refreshDerived({
    ...d,
    links: d.links.map((l) => {
      if (l.id !== edgeId || l.type !== "TRUSTS" || !l.trust) return l;
      const n = (l.trust.interactionCount ?? 1);
      const prev = l.trust.outcome ?? 0;
      const outcome = Math.max(-1, Math.min(1, (prev * n + value) / (n + 1)));
      return { ...l, trust: { ...l.trust, outcome, lastUpdate: now } };
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Runtime Trust Engine (Doc §6 Runtime, §7 Transfer, §8 Recommendation) */
/* ------------------------------------------------------------------ */

export interface TrustQuery {
  topic: string;
  geo?: string;
  context?: string;
  /**
   * Topics considered semantically equivalent to `topic`, precomputed by the
   * service via embeddings (Feature 9). When present, an edge scoped to any of
   * these also matches — so a "dentist" search surfaces an "orthodontist" you
   * trust. Absent ⇒ pure equality (+ parent) matching, unchanged.
   */
  expandedTopics?: string[];
}

/** Tunables (Doc: max hops configurable; decay with distance). */
export const TRUST_MAX_HOPS = 2;
export const TRUST_DECAY = 0.6;
export const TRUST_W_OUTCOME = 0.3;
/**
 * A friendship is a light first-hop bridge: your network is your friends, so a
 * broker your friend trusts surfaces — but weighted well below someone you trust
 * directly. (Friendship carries reach, not topic expertise.)
 */
export const FRIEND_TRUST = 0.45;

type AdjEntry = { kind: "trust" | "friend"; to: string; link: GLink };

/**
 * Adjacency for trust transfer: directed TRUSTS edges, PLUS FRIENDS_WITH edges
 * as bidirectional light bridges. A recommendation is only ever produced by a
 * TRUSTS edge (the final hop) — friendship only carries you to a friend whose
 * trust you then follow.
 */
function buildAdj(links: GLink[]): Map<string, AdjEntry[]> {
  const out = new Map<string, AdjEntry[]>();
  const push = (from: string, e: AdjEntry) => {
    const b = out.get(from);
    if (b) b.push(e);
    else out.set(from, [e]);
  };
  for (const l of links) {
    if (l.type === "TRUSTS" && l.trust) {
      push(endId(l.source), { kind: "trust", to: endId(l.target), link: l });
    } else if (l.type === "FRIENDS_WITH") {
      const a = endId(l.source);
      const b = endId(l.target);
      push(a, { kind: "friend", to: b, link: l });
      push(b, { kind: "friend", to: a, link: l });
    }
  }
  return out;
}

/**
 * Topic match: exact code, parent topic (cafe → food), or — when the service
 * supplies semantically-similar topics via embeddings — any expanded topic
 * (dentist ≈ orthodontist). Geo still excludes only when both sides specify and
 * differ. Equality remains the default when `expandedTopics` is absent.
 */
export function topicMatch(edge: TrustScope, query: TrustQuery): boolean {
  const t = query.topic;
  const matchesTopic =
    edge.topic === t ||
    TOPIC_PARENT[edge.topic] === t ||
    (query.expandedTopics?.includes(edge.topic) ?? false);
  if (!matchesTopic) return false;
  if (query.geo && edge.geo && edge.geo !== query.geo) return false;
  return true;
}

interface TrustResult {
  targetId: string;
  strength: number;
  path: TrustPathHop[];
  outcome: number;
}

/**
 * Transfer trust from `meId`, decaying with distance. Follows your TRUSTS edges
 * (in-scope) and your FRIENDS_WITH edges (light bridges); a target only becomes a
 * candidate when the edge INTO it is a topic-matching TRUSTS edge — so we only
 * ever recommend things someone actually trusts on the topic, reached directly or
 * through a friend. Keeps the strongest path to each target. BFS bounded by maxHops.
 */
function transferTrust(
  adj: Map<string, AdjEntry[]>,
  meId: string,
  query: TrustQuery,
  maxHops = TRUST_MAX_HOPS,
  relStrength?: Map<string, number>,
): Map<string, TrustResult> {
  const best = new Map<string, TrustResult>();
  const queue: { node: string; strength: number; hops: number; path: TrustPathHop[] }[] = [
    { node: meId, strength: 1, hops: 0, path: [] },
  ];

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.hops >= maxHops) continue;
    for (const e of adj.get(cur.node) ?? []) {
      if (e.to === meId) continue;
      let hopTrust: number;
      let topic: string;
      let outcome = 0;
      if (e.kind === "trust") {
        if (!e.link.trust || !topicMatch(e.link.trust.scope, query)) continue;
        hopTrust = e.link.trust.confidence;
        topic = e.link.trust.scope.topic;
        outcome = e.link.trust.outcome ?? 0;
      } else {
        // A friend bridge — topic-agnostic, light. Relationship strength (a
        // derived, personalization-only tie weight) modulates HOW MUCH trust
        // flows across MY direct friendships; it never creates trust and never
        // changes reputation (Doc #9). Only applied on the first hop out of me,
        // where a viewer→friend strength is meaningful; deeper friend bridges
        // keep the flat default. Absent map ⇒ exactly the legacy FRIEND_TRUST.
        hopTrust = (cur.node === meId ? relStrength?.get(e.to) : undefined) ?? FRIEND_TRUST;
        topic = query.topic;
      }
      const decay = Math.pow(TRUST_DECAY, cur.hops); // first hop = no decay
      const strength = cur.strength * hopTrust * decay;
      const hop: TrustPathHop = {
        edgeId: e.link.id,
        from: cur.node,
        to: e.to,
        topic,
        confidence: hopTrust,
        kind: e.kind,
      };
      const path = [...cur.path, hop];
      // Only a TRUSTS edge produces a recommendation (friendship just carries reach).
      if (e.kind === "trust") {
        const existing = best.get(e.to);
        if (!existing || strength > existing.strength) {
          best.set(e.to, { targetId: e.to, strength, path, outcome });
        }
      }
      queue.push({ node: e.to, strength, hops: cur.hops + 1, path });
    }
  }
  return best;
}

/** Human-readable "why" sentence from a trust path (Doc §9 Explainability). */
function explain(path: TrustPathHop[], nodeLabel: (id: string) => string, outcome: number): string {
  const last = path[path.length - 1];
  const topic = last.topic.replace(/_/g, " ");
  let s: string;
  if (path.length === 1) {
    s = `${nodeLabel(last.from)} trusts this on ${topic}.`;
  } else {
    const bridge = path[0];
    const trusterLabel = nodeLabel(last.from);
    s =
      bridge.kind === "friend"
        ? `Your friend ${nodeLabel(bridge.to)} trusts this on ${topic}.`
        : `${nodeLabel(path[0].from)} → ${path.map((h) => nodeLabel(h.to)).join(" → ")} — trust reaches it on ${topic}.`;
    // If the chain is deeper than a single friend bridge, name the direct truster.
    if (path.length > 2 || (path.length === 2 && bridge.kind === "trust")) {
      s = `${trusterLabel} trusts this on ${topic} — reached via ${nodeLabel(bridge.to)}.`;
    }
  }
  if (outcome > 0) s += ` ${outcome >= 0.5 ? "Strong" : "Some"} positive outcomes recorded.`;
  else if (outcome < 0) s += ` Caution: negative outcomes recorded.`;
  return s;
}

/**
 * Trust-ranked recommendations for a query scope. Keeps the existing
 * `Recommendation {nodeId,score,via[],reason}` contract (so the explainability UI
 * works unchanged) and adds `trustPath`. Candidates = nodes reachable via in-scope
 * trust paths; `via` = the people along the path.
 */
export function computeTrustRecommendations(
  nodes: GNode[],
  links: GLink[],
  meId: string,
  query: TrustQuery,
  opts: { dismissed?: string[]; limit?: number; relationshipStrength?: Map<string, number> } = {},
): Recommendation[] {
  const q: TrustQuery = { ...query, topic: normalizeTopic(query.topic), geo: query.geo ? norm(query.geo) : undefined };
  if (!q.topic) return [];
  const labelById = new Map(nodes.map((n) => [n.id, n.label] as const));
  const nodeLabel = (id: string) => labelById.get(id) ?? id;
  const dismissed = new Set(opts.dismissed ?? []);

  const adj = buildAdj(links);
  const reached = transferTrust(adj, meId, q, TRUST_MAX_HOPS, opts.relationshipStrength);

  const recs: Recommendation[] = [];
  for (const r of reached.values()) {
    if (dismissed.has(r.targetId)) continue;
    const score = r.strength * (1 + TRUST_W_OUTCOME * r.outcome);
    if (score <= 0) continue;
    // via = intermediate people (exclude the final target, include path interior)
    const via = r.path.map((h) => h.from).filter((id) => id !== meId);
    recs.push({
      nodeId: r.targetId,
      score,
      via: via.length ? via : [r.path[0]?.from].filter(Boolean) as string[],
      reason: explain(r.path, nodeLabel, r.outcome),
      trustPath: r.path,
    });
  }
  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, opts.limit ?? 12);
}
