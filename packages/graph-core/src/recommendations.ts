/**
 * First-class Recommendation & Outcome entities (Doc #9/#11, Phase 4).
 *
 * A Recommendation is a FIRST-CLASS, IMMUTABLE graph node — not an ephemeral
 * scored object and not a property on a trust edge. It captures the structured
 * semantics the spec freezes:
 *
 *   who        → the author           (AUTHORED: person → recommendation)
 *   what        → the specialist        (TARGETS: recommendation → provider)
 *   why         → reasons[]             (on the node)
 *   in which    → context / topic       (on the node)
 *   for whom    → audience              (on the node)
 *
 * Its original content NEVER changes after publication ("New evidence should
 * enrich the recommendation rather than overwrite its original statement",
 * Doc #9). Evidence accrues as independent **Outcome** nodes attached via
 * SUPPORTED_BY — multiple outcomes may support one recommendation, and the
 * recommendation itself stays historically accurate.
 *
 * Persistence is free: the Neo4j store is generic (`:Entity`/`:REL` with the
 * type carried as a property), so these node/edge types round-trip with no
 * store changes. Pure + deterministic — the caller supplies ids + timestamps.
 */
import type { Dataset, GLink, GNode } from "./types";
import { refreshDerived } from "./recommend";

/** The structured "who/what/why/context/for-whom" of one recommendation. */
export interface RecommendationInput {
  /** Stable id (e.g. `rec_...`). Re-using an existing id is a no-op (immutable). */
  id: string;
  authorId: string; // who
  targetId: string; // what — the specialist/provider node
  topic: string; // domain
  context?: string; // situation ("EB2 NIW", "first home", …)
  audience?: string; // for whom ("researchers", "families", …)
  reasons?: string[]; // why (predefined reason codes / short phrases)
  note?: string; // optional free-text evidence
  createdAt: number;
}

export interface OutcomeInput {
  id: string; // stable id (e.g. `oc_...`)
  contributorId: string; // who reported the outcome
  value: number; // normalized [-1,1]
  kind?: string; // "worked" | "failed" | …
  detail?: string;
  at: number;
}

/** Immutable content stored on a recommendation node's `properties`. */
export interface RecommendationProps {
  kind: "recommendation";
  authorId: string;
  targetId: string;
  topic: string;
  context?: string;
  audience?: string;
  reasons: string[];
  note?: string;
  createdAt: number;
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Publish a recommendation: a new immutable `recommendation` node + AUTHORED
 * (author→rec) + TARGETS (rec→provider) edges. Idempotent by id — re-publishing
 * the same id returns the dataset unchanged (recommendations are never rewritten).
 */
export function createRecommendation(d: Dataset, input: RecommendationInput): Dataset {
  if (d.nodes.some((n) => n.id === input.id)) return refreshDerived(d); // immutable: no overwrite
  const author = d.nodes.find((n) => n.id === input.authorId);
  const target = d.nodes.find((n) => n.id === input.targetId);
  if (!author) throw new Error(`unknown author: ${input.authorId}`);
  if (!target) throw new Error(`unknown target: ${input.targetId}`);
  if (author.type !== "person") throw new Error("a recommendation must be authored by a person");
  if (!input.topic) throw new Error("a recommendation needs a topic");

  const props: RecommendationProps = {
    kind: "recommendation",
    authorId: input.authorId,
    targetId: input.targetId,
    topic: input.topic,
    context: input.context,
    audience: input.audience,
    reasons: input.reasons ?? [],
    note: input.note,
    createdAt: input.createdAt,
  };
  const recNode: GNode = {
    id: input.id,
    type: "recommendation",
    label: `${author.label} → ${target.label}`,
    sub: input.context ? `${input.topic} · ${input.context}` : input.topic,
    clusters: [],
    properties: props as unknown as Record<string, unknown>,
  };
  const authored: GLink = {
    id: `ux_authored_${input.id}`,
    source: input.authorId,
    target: input.id,
    type: "AUTHORED",
    weight: 1,
    scope: "user",
    userId: input.authorId,
  };
  const targets: GLink = {
    id: `ux_targets_${input.id}`,
    source: input.id,
    target: input.targetId,
    type: "TARGETS",
    weight: 1,
  };
  return refreshDerived({
    ...d,
    nodes: [...d.nodes, recNode],
    links: [...d.links, authored, targets],
  });
}

/**
 * Attach an independent Outcome node to a recommendation via SUPPORTED_BY. The
 * recommendation's original content is untouched — evidence only accumulates.
 * Idempotent by outcome id.
 */
export function attachOutcome(d: Dataset, recId: string, input: OutcomeInput): Dataset {
  if (d.nodes.some((n) => n.id === input.id)) return refreshDerived(d);
  const rec = d.nodes.find((n) => n.id === recId);
  if (!rec) throw new Error(`unknown recommendation: ${recId}`);
  if (rec.type !== "recommendation") throw new Error(`${recId} is not a recommendation`);

  const outcomeNode: GNode = {
    id: input.id,
    type: "outcome",
    label: input.kind ?? (input.value >= 0 ? "worked" : "failed"),
    sub: (rec.properties as RecommendationProps | undefined)?.topic,
    clusters: [],
    properties: {
      kind: "outcome",
      recId,
      contributorId: input.contributorId,
      value: clamp1(input.value),
      outcomeKind: input.kind ?? (input.value >= 0 ? "positive" : "negative"),
      detail: input.detail,
      at: input.at,
    },
  };
  const supportedBy: GLink = {
    id: `ux_supported_${input.id}`,
    source: recId,
    target: input.id,
    type: "SUPPORTED_BY",
    weight: 1,
  };
  return refreshDerived({
    ...d,
    nodes: [...d.nodes, outcomeNode],
    links: [...d.links, supportedBy],
  });
}

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** All outcome nodes supporting a recommendation (its accumulated evidence). */
export function outcomesForRecommendation(d: Dataset, recId: string): GNode[] {
  const ids = new Set(
    d.links.filter((l) => l.type === "SUPPORTED_BY" && endId(l.source) === recId).map((l) => endId(l.target)),
  );
  return d.nodes.filter((n) => ids.has(n.id));
}

/** All recommendations that point at a given specialist/provider. */
export function recommendationsForTarget(d: Dataset, targetId: string): GNode[] {
  const ids = new Set(
    d.links.filter((l) => l.type === "TARGETS" && endId(l.target) === targetId).map((l) => endId(l.source)),
  );
  return d.nodes.filter((n) => ids.has(n.id) && n.type === "recommendation");
}

/** A recommendation's consensus signal from its outcomes: mean value in [-1,1]. */
export function recommendationConsensus(
  d: Dataset,
  recId: string,
): { mean: number; count: number; contributors: number } {
  const outs = outcomesForRecommendation(d, recId);
  if (outs.length === 0) return { mean: 0, count: 0, contributors: 0 };
  const contributors = new Set<string>();
  let sum = 0;
  for (const o of outs) {
    const p = o.properties as { value?: number; contributorId?: string } | undefined;
    sum += clamp1(Number(p?.value ?? 0));
    if (p?.contributorId) contributors.add(p.contributorId);
  }
  return { mean: sum / outs.length, count: outs.length, contributors: contributors.size };
}
