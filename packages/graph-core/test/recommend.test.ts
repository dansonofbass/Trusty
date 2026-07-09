/**
 * Recommendation engine — explainable friend-overlap suggestions.
 * The product's core invariant: no because-path → no recommendation.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeRecommendations, recomputeVals } from "../src/index.ts";
import type { GLink, GNode } from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
const book = (id: string): GNode => ({ id, type: "book", label: id, clusters: [] });
const link = (id: string, s: string, t: string, type: GLink["type"]): GLink => ({ id, source: s, target: t, type, weight: 1 });

test("every recommendation carries a because-path (via + reason)", () => {
  const nodes = [person("me"), person("f1"), person("f2"), book("b1")];
  const links = [
    link("e1", "me", "f1", "FRIENDS_WITH"),
    link("e2", "f1", "b1", "READS"),
    link("e3", "f1", "f2", "FRIENDS_WITH"),
  ];
  const recs = computeRecommendations(nodes, links, "me");
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok(r.via.length >= 1, "has a via path");
    assert.ok(r.reason.length > 0, "has an explanation");
  }
});

test("content a friend engages with is recommended via that friend", () => {
  const nodes = [person("me"), person("f1"), book("b1")];
  const links = [link("e1", "me", "f1", "FRIENDS_WITH"), link("e2", "f1", "b1", "READS")];
  const r = computeRecommendations(nodes, links, "me").find((x) => x.nodeId === "b1");
  assert.ok(r);
  assert.ok(r!.via.includes("f1"));
});

test("a friend-of-friend is recommended as a person", () => {
  const nodes = [person("me"), person("f1"), person("f2")];
  const links = [link("e1", "me", "f1", "FRIENDS_WITH"), link("e3", "f1", "f2", "FRIENDS_WITH")];
  const r = computeRecommendations(nodes, links, "me").find((x) => x.nodeId === "f2");
  assert.ok(r);
  assert.ok(r!.via.includes("f1"));
});

test("dismissed nodes are never recommended", () => {
  const nodes = [person("me"), person("f1"), book("b1")];
  const links = [link("e1", "me", "f1", "FRIENDS_WITH"), link("e2", "f1", "b1", "READS")];
  const recs = computeRecommendations(nodes, links, "me", { dismissed: ["b1"] });
  assert.equal(recs.find((x) => x.nodeId === "b1"), undefined);
});

test("recomputeVals assigns a positive size to every node", () => {
  const nodes = [person("me"), book("b1")];
  recomputeVals(nodes, [link("e2", "me", "b1", "READS")]);
  assert.ok(nodes.every((n) => typeof n.val === "number" && (n.val ?? 0) > 0));
});

/* ---- Phase A: the personalization blend (signals injected via opts) ---- */

// Two books both read by the same single friend → structurally symmetric, so
// any ranking difference must come from the injected signals.
function twoBooks() {
  const nodes = [person("me"), person("f1"), book("b1"), book("b2")];
  const links = [
    link("e1", "me", "f1", "FRIENDS_WITH"),
    link("e2", "f1", "b1", "READS"),
    link("e3", "f1", "b2", "READS"),
  ];
  return { nodes, links };
}
const idx = (recs: { nodeId: string }[], id: string) => recs.findIndex((r) => r.nodeId === id);
const scoreOf = (recs: { nodeId: string; score: number }[], id: string) =>
  recs.find((r) => r.nodeId === id)!.score;

test("no signals ⇒ legacy structural scoring is byte-for-byte unchanged", () => {
  const { nodes, links } = twoBooks();
  const legacy = computeRecommendations(nodes, links, "me");
  const withEmptyOpts = computeRecommendations(nodes, links, "me", {});
  assert.deepEqual(
    legacy.map((r) => ({ id: r.nodeId, score: r.score })),
    withEmptyOpts.map((r) => ({ id: r.nodeId, score: r.score })),
  );
  assert.equal(scoreOf(legacy, "b1"), scoreOf(legacy, "b2")); // structurally symmetric
  assert.ok(legacy.every((r) => r.factors === undefined)); // no blend factors on legacy path
});

test("topic affinity lifts a rec above a structurally-equal peer", () => {
  const { nodes, links } = twoBooks();
  const recs = computeRecommendations(nodes, links, "me", {
    signals: { topicAffinity: new Map([["b1", 1]]) },
  });
  assert.ok(scoreOf(recs, "b1") > scoreOf(recs, "b2"));
  assert.ok(idx(recs, "b1") < idx(recs, "b2"));
  assert.ok(recs.find((r) => r.nodeId === "b1")!.factors?.some((f) => f.channel === "topic"));
});

test("community boost, negative outcome, and fatigue each move the score the right way", () => {
  const { nodes, links } = twoBooks();
  const comm = computeRecommendations(nodes, links, "me", {
    signals: { communityBoost: new Map([["b2", 1]]) },
  });
  assert.ok(scoreOf(comm, "b2") > scoreOf(comm, "b1"));

  const neg = computeRecommendations(nodes, links, "me", {
    signals: { outcomeSignal: new Map([["b1", -1]]) },
  });
  assert.ok(scoreOf(neg, "b1") < scoreOf(neg, "b2"));

  const fat = computeRecommendations(nodes, links, "me", {
    signals: { fatigue: new Map([["b1", 1]]) },
  });
  assert.ok(scoreOf(fat, "b1") < scoreOf(fat, "b2"));
});

test("a topic-affine node with NO structural path is still never recommended", () => {
  const { nodes, links } = twoBooks();
  nodes.push(book("b3")); // orphan — connected to nobody
  const recs = computeRecommendations(nodes, links, "me", {
    signals: { topicAffinity: new Map([["b3", 1]]) },
  });
  // no because-path → no recommendation, even with max topic affinity
  assert.equal(recs.find((r) => r.nodeId === "b3"), undefined);
});
