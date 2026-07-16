/**
 * First-class Recommendation & Outcome entities (issue #9/#11, Phase 4):
 * immutable recommendations + independent outcome nodes that accumulate evidence.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecommendation,
  attachOutcome,
  outcomesForRecommendation,
  recommendationsForTarget,
  recommendationConsensus,
  computeRecommendations,
  type Dataset,
  type GNode,
} from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
const provider = (id: string): GNode => ({ id, type: "person", label: id, entityType: "lawyer", clusters: [] });
const world = (): Dataset => ({
  nodes: [person("me"), person("f1"), provider("prov")],
  links: [{ id: "fw", source: "me", target: "f1", type: "FRIENDS_WITH", weight: 1 }],
  meId: "me",
  recommendations: [],
});

const recInput = (over = {}) => ({
  id: "rec1",
  authorId: "me",
  targetId: "prov",
  topic: "lawyer",
  context: "EB2 NIW",
  audience: "researchers",
  reasons: ["responsive", "knowledgeable"],
  createdAt: 1000,
  ...over,
});

test("createRecommendation: first-class node with AUTHORED + TARGETS edges and structured props", () => {
  const d = createRecommendation(world(), recInput());
  const rec = d.nodes.find((n) => n.id === "rec1")!;
  assert.equal(rec.type, "recommendation");
  const p = rec.properties as Record<string, unknown>;
  assert.equal(p.authorId, "me"); // who
  assert.equal(p.targetId, "prov"); // what
  assert.deepEqual(p.reasons, ["responsive", "knowledgeable"]); // why
  assert.equal(p.context, "EB2 NIW"); // in which context
  assert.equal(p.audience, "researchers"); // for whom
  assert.ok(d.links.some((l) => l.type === "AUTHORED" && l.source === "me" && l.target === "rec1"));
  assert.ok(d.links.some((l) => l.type === "TARGETS" && l.source === "rec1" && l.target === "prov"));
});

test("createRecommendation: validates author/target and requires a person author", () => {
  assert.throws(() => createRecommendation(world(), recInput({ authorId: "ghost" })), /unknown author/);
  assert.throws(() => createRecommendation(world(), recInput({ targetId: "ghost" })), /unknown target/);
  assert.throws(() => createRecommendation(world(), recInput({ topic: "" })), /topic/);
});

test("createRecommendation is immutable: re-publishing the same id is a no-op", () => {
  const d1 = createRecommendation(world(), recInput());
  const d2 = createRecommendation(d1, recInput({ reasons: ["TAMPERED"] }));
  const rec = d2.nodes.find((n) => n.id === "rec1")!;
  assert.deepEqual((rec.properties as Record<string, unknown>).reasons, ["responsive", "knowledgeable"]);
  assert.equal(d2.nodes.filter((n) => n.id === "rec1").length, 1);
});

test("attachOutcome: independent node via SUPPORTED_BY; recommendation content untouched", () => {
  let d = createRecommendation(world(), recInput());
  const before = JSON.stringify(d.nodes.find((n) => n.id === "rec1")!.properties);
  d = attachOutcome(d, "rec1", { id: "oc1", contributorId: "u1", value: 0.9, kind: "worked", at: 2000 });
  const oc = d.nodes.find((n) => n.id === "oc1")!;
  assert.equal(oc.type, "outcome");
  assert.equal((oc.properties as Record<string, unknown>).value, 0.9);
  assert.ok(d.links.some((l) => l.type === "SUPPORTED_BY" && l.source === "rec1" && l.target === "oc1"));
  // The recommendation's original statement never changed.
  assert.equal(JSON.stringify(d.nodes.find((n) => n.id === "rec1")!.properties), before);
});

test("outcomes accumulate; consensus is the mean over independent contributors", () => {
  let d = createRecommendation(world(), recInput());
  d = attachOutcome(d, "rec1", { id: "oc1", contributorId: "u1", value: 1, at: 1 });
  d = attachOutcome(d, "rec1", { id: "oc2", contributorId: "u2", value: 0.5, at: 2 });
  d = attachOutcome(d, "rec1", { id: "oc3", contributorId: "u3", value: 0, at: 3 });
  assert.equal(outcomesForRecommendation(d, "rec1").length, 3);
  const c = recommendationConsensus(d, "rec1");
  assert.equal(c.count, 3);
  assert.equal(c.contributors, 3);
  assert.ok(Math.abs(c.mean - 0.5) < 1e-9);
});

test("attachOutcome is idempotent by id and validates the recommendation", () => {
  let d = createRecommendation(world(), recInput());
  d = attachOutcome(d, "rec1", { id: "oc1", contributorId: "u1", value: 1, at: 1 });
  d = attachOutcome(d, "rec1", { id: "oc1", contributorId: "u1", value: -1, at: 2 }); // same id → no-op
  assert.equal(outcomesForRecommendation(d, "rec1").length, 1);
  assert.throws(() => attachOutcome(d, "ghost", { id: "ocX", contributorId: "u1", value: 1, at: 1 }), /unknown recommendation/);
});

test("recommendationsForTarget lists every recommendation pointing at a provider", () => {
  let d = createRecommendation(world(), recInput({ id: "rec1" }));
  d = createRecommendation(d, recInput({ id: "rec2", authorId: "f1" }));
  const recs = recommendationsForTarget(d, "prov").map((n) => n.id).sort();
  assert.deepEqual(recs, ["rec1", "rec2"]);
});

test("recommendation/outcome nodes never leak into the social friend-overlap frontier", () => {
  let d = createRecommendation(world(), recInput());
  d = attachOutcome(d, "rec1", { id: "oc1", contributorId: "u1", value: 1, at: 1 });
  // f1 is my friend and is AUTHORED-adjacent to nothing that should surface as content.
  const recs = computeRecommendations(d.nodes, d.links, "me");
  assert.ok(!recs.some((r) => r.nodeId === "rec1" || r.nodeId === "oc1"), "evidence nodes are not social content");
});
