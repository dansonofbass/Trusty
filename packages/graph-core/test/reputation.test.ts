/**
 * Recommendation-core tests (issue #8): topic-scoped reputation math, the unified
 * ranking pipeline, and relationship-strength independence in trust transfer.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateReputation,
  rankCandidates,
  explainRanking,
  FORBIDDEN_SIGNALS,
  addTrustEdge,
  computeTrustRecommendations,
  type ReputationSample,
  type RankingCandidate,
  type Dataset,
  type GNode,
} from "../src/index.ts";

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;
const sample = (value: number, contributorId: string, ageDays = 0): ReputationSample => ({
  value,
  contributorId,
  atMs: NOW - ageDays * DAY,
});

/* ------------------------------ reputation ------------------------------ */

test("reputation: a single positive outcome does NOT max the score (shrinkage)", () => {
  const rep = aggregateReputation([sample(1, "u1")], { now: NOW });
  assert.ok(rep.score < 0.5, `one outcome should stay modest, got ${rep.score}`);
  assert.equal(rep.samples, 1);
  assert.equal(rep.contributors, 1);
});

test("reputation: score rises with more consistent positive evidence", () => {
  const few = aggregateReputation([sample(1, "u1"), sample(1, "u2")], { now: NOW });
  const many = aggregateReputation(
    Array.from({ length: 12 }, (_, i) => sample(1, `u${i}`)),
    { now: NOW },
  );
  assert.ok(many.score > few.score, "more evidence ⇒ higher (but still shrunk) score");
  assert.ok(many.score < 1, "never saturates to 1");
});

test("reputation: confidence grows with INDEPENDENT contributors, not raw volume", () => {
  // 10 outcomes from ONE contributor vs 3 outcomes from 3 contributors.
  const oneVoice = aggregateReputation(
    Array.from({ length: 10 }, () => sample(1, "u1")),
    { now: NOW },
  );
  const threeVoices = aggregateReputation([sample(1, "a"), sample(1, "b"), sample(1, "c")], { now: NOW });
  assert.equal(oneVoice.contributors, 1);
  assert.equal(threeVoices.contributors, 3);
  assert.ok(threeVoices.confidence > oneVoice.confidence, "independence beats volume for confidence");
});

test("reputation: time-decay — stale outcomes weigh less than recent ones", () => {
  const recent = aggregateReputation([sample(1, "u1", 1)], { now: NOW, halfLifeDays: 30 });
  const stale = aggregateReputation([sample(1, "u1", 400)], { now: NOW, halfLifeDays: 30 });
  assert.ok(recent.score > stale.score, "a fresh good outcome outweighs an old one");
});

test("reputation: empty evidence is neutral with zero confidence", () => {
  const rep = aggregateReputation([], { now: NOW });
  assert.equal(rep.score, 0);
  assert.equal(rep.confidence, 0);
  assert.equal(rep.effective, 0);
});

/* --------------------------- ranking pipeline --------------------------- */

const cand = (over: Partial<RankingCandidate>): RankingCandidate => ({
  nodeId: "x",
  trustStrength: 0.5,
  ...over,
});

test("ranking: higher topic reputation outranks a lower-reputation peer at equal trust", () => {
  const out = rankCandidates([
    cand({ nodeId: "hi", reputation: 0.8 }),
    cand({ nodeId: "lo", reputation: 0 }),
  ]);
  assert.equal(out[0].nodeId, "hi");
  assert.ok(out[0].factors.some((f) => f.stage === "topicReputation"));
});

test("ranking: relationship strength reorders WITHOUT changing the trust factor (independence)", () => {
  const out = rankCandidates([
    cand({ nodeId: "close", relationship: 0.9 }),
    cand({ nodeId: "far", relationship: 0 }),
  ]);
  assert.equal(out[0].nodeId, "close", "closer tie ranks higher");
  // Trust base is identical for both — relationship never altered it.
  const trustOf = (id: string) =>
    out.find((r) => r.nodeId === id)!.factors.find((f) => f.stage === "trust")!.contribution;
  assert.equal(trustOf("close"), trustOf("far"), "relationship must not touch the trust factor");
});

test("ranking: reputation and relationship are SEPARATE factors, never merged", () => {
  const [r] = rankCandidates([cand({ reputation: 0.6, relationship: 0.5 })]);
  const stages = r.factors.map((f) => f.stage);
  assert.ok(stages.includes("topicReputation"));
  assert.ok(stages.includes("relationshipStrength"));
});

test("ranking: stable + deterministic tie-break by nodeId", () => {
  const a = rankCandidates([cand({ nodeId: "b" }), cand({ nodeId: "a" })]);
  const b = rankCandidates([cand({ nodeId: "a" }), cand({ nodeId: "b" })]);
  assert.deepEqual(a.map((r) => r.nodeId), b.map((r) => r.nodeId), "order independent of input order");
  assert.equal(a[0].nodeId, "a");
});

test("ranking: eligibility + fraud gates drop candidates", () => {
  const out = rankCandidates([
    cand({ nodeId: "ok" }),
    cand({ nodeId: "ineligible", eligible: false }),
    cand({ nodeId: "fraud", fraudRisk: 0.95 }),
  ]);
  assert.deepEqual(out.map((r) => r.nodeId), ["ok"]);
});

test("ranking: pay-to-rank signals are structurally excluded (anti-manipulation)", () => {
  // The candidate shape has no payment/profile/listen field — these can't enter
  // scoring. The forbidden list documents that contract.
  assert.ok(FORBIDDEN_SIGNALS.includes("payment"));
  assert.ok(FORBIDDEN_SIGNALS.includes("profile_completeness"));
  assert.ok(FORBIDDEN_SIGNALS.includes("listen_count"));
});

test("ranking: explanation references evidence, not raw scores", () => {
  const [r] = rankCandidates([cand({ reputation: 0.8, outcome: 0.6 })]);
  const why = explainRanking(r);
  assert.ok(why.length > 0);
  assert.ok(!/\d/.test(why), `explanation should not leak numbers: "${why}"`);
});

/* ---------------- relationship strength in trust transfer ---------------- */

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
function friendBridgeWorld(): Dataset {
  const d: Dataset = {
    nodes: [person("me"), person("f1"), person("prov")],
    links: [{ id: "fw", source: "me", target: "f1", type: "FRIENDS_WITH", weight: 1 }],
    meId: "me",
    recommendations: [],
  };
  return addTrustEdge(d, "f1", "prov", { topic: "broker" }, { now: 1, confidence: 0.9 });
}

test("relationship strength: a stronger tie increases a friend-bridged trust score", () => {
  const d = friendBridgeWorld();
  const base = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" });
  const strong = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" }, {
    relationshipStrength: new Map([["f1", 0.9]]),
  });
  const weak = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" }, {
    relationshipStrength: new Map([["f1", 0.1]]),
  });
  const s = (recs: ReturnType<typeof computeTrustRecommendations>) =>
    recs.find((r) => r.nodeId === "prov")!.score;
  assert.ok(s(strong) > s(base), "a closer tie carries more trust");
  assert.ok(s(weak) < s(base), "a weaker tie carries less");
});

test("relationship strength: changes score but NOT the trust path (independence)", () => {
  const d = friendBridgeWorld();
  const base = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" });
  const strong = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" }, {
    relationshipStrength: new Map([["f1", 0.95]]),
  });
  const pathOf = (recs: ReturnType<typeof computeTrustRecommendations>) =>
    recs.find((r) => r.nodeId === "prov")!.trustPath!.map((h) => `${h.from}->${h.to}:${h.kind}`);
  assert.deepEqual(pathOf(strong), pathOf(base), "the path (who vouches) is unchanged by tie strength");
});

test("relationship strength: absent map reproduces the legacy flat-friend behavior", () => {
  const d = friendBridgeWorld();
  const legacy = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" });
  const explicitDefault = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" }, {
    relationshipStrength: new Map(),
  });
  assert.equal(
    legacy.find((r) => r.nodeId === "prov")!.score,
    explicitDefault.find((r) => r.nodeId === "prov")!.score,
  );
});
