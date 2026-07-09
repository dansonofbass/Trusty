/**
 * Trust engine — directed topic-scoped edges + runtime transfer with decay.
 * The headline feature: recommendations traceable to people you trust.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  addTrustEdge,
  removeTrustEdge,
  applyOutcomeToEdge,
  topicMatch,
  validateScope,
  computeTrustRecommendations,
} from "../src/index.ts";
import type { Dataset, GLink, GNode } from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
const world = (): Dataset => ({
  nodes: [person("me"), person("f1"), person("prov")],
  links: [],
  meId: "me",
  recommendations: [],
});

test("addTrustEdge: creates an owned TRUSTS edge with a validated scope", () => {
  const d = addTrustEdge(world(), "me", "prov", { topic: "broker" }, { now: 1, confidence: 0.9 });
  const e = d.links.find((l) => l.type === "TRUSTS")!;
  assert.equal(e.scope, "user");
  assert.equal(e.userId, "me");
  assert.equal(e.trust!.scope.topic, "broker");
  assert.equal(e.trust!.confidence, 0.9);
});

test("addTrustEdge rejects self-trust and a missing topic", () => {
  assert.throws(() => addTrustEdge(world(), "me", "me", { topic: "broker" }, { now: 1 }), /yourself/);
  assert.throws(() => addTrustEdge(world(), "me", "prov", { topic: "" }, { now: 1 }), /topic/);
});

test("validateScope normalizes topic + geo; topicMatch handles parent topics + geo", () => {
  const s = validateScope({ topic: "Broker", geo: "Yerevan" });
  assert.equal(s.topic, "broker");
  assert.equal(s.geo, "yerevan");
  // a child-topic edge matches a parent-topic query (cafe → food), not the reverse
  assert.equal(topicMatch({ topic: "cafe" }, { topic: "food" }), true);
  assert.equal(topicMatch({ topic: "food" }, { topic: "cafe" }), false);
  assert.equal(topicMatch({ topic: "broker" }, { topic: "dentist" }), false);
  // geo excludes only when both sides specify and differ
  assert.equal(topicMatch({ topic: "broker", geo: "yerevan" }, { topic: "broker", geo: "tbilisi" }), false);
  assert.equal(topicMatch({ topic: "broker" }, { topic: "broker", geo: "yerevan" }), true);
});

test("computeTrustRecommendations: direct trust surfaces the provider at hop 1", () => {
  const d = addTrustEdge(world(), "me", "prov", { topic: "broker" }, { now: 1, confidence: 0.9 });
  const recs = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" });
  const r = recs.find((x) => x.nodeId === "prov");
  assert.ok(r, "prov recommended");
  assert.equal(r!.trustPath?.length, 1);
  assert.equal(r!.trustPath?.[0].kind, "trust");
});

test("computeTrustRecommendations: trust transfers through a friend bridge", () => {
  const d0 = world();
  d0.links.push({ id: "fw", source: "me", target: "f1", type: "FRIENDS_WITH", weight: 1 });
  const d = addTrustEdge(d0, "f1", "prov", { topic: "broker" }, { now: 1, confidence: 0.9 });
  const recs = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "broker" });
  const r = recs.find((x) => x.nodeId === "prov");
  assert.ok(r, "prov surfaced through the friend");
  assert.ok((r!.trustPath?.length ?? 0) >= 2);
  assert.equal(r!.trustPath?.[0].kind, "friend");
});

test("computeTrustRecommendations: a different topic returns nothing", () => {
  const d = addTrustEdge(world(), "me", "prov", { topic: "broker" }, { now: 1 });
  const recs = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "dentist" });
  assert.equal(recs.find((x) => x.nodeId === "prov"), undefined);
});

test("applyOutcomeToEdge folds a rolling outcome into [-1,1]", () => {
  let d = addTrustEdge(world(), "me", "prov", { topic: "broker" }, { now: 1 });
  const id = d.links.find((l) => l.type === "TRUSTS")!.id;
  d = applyOutcomeToEdge(d, id, 1, 2);
  const o = d.links.find((l) => l.id === id)!.trust!.outcome!;
  assert.ok(o > 0 && o <= 1); // first 👍 on a fresh edge → 0.5
});

test("removeTrustEdge only removes the owner's edge", () => {
  let d = addTrustEdge(world(), "me", "prov", { topic: "broker" }, { now: 1 });
  const id = d.links.find((l) => l.type === "TRUSTS")!.id;
  assert.throws(() => removeTrustEdge(d, "f1", id), /not your/);
  d = removeTrustEdge(d, "me", id);
  assert.equal(d.links.find((l: GLink) => l.type === "TRUSTS"), undefined);
});
