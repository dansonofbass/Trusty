/**
 * Analytics — the graphology projection, ego bounds, paths, shared neighbours.
 * These drive the bounded-galaxy visibility model the whole canvas depends on.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toGraph, visibleIds, egoIds, commonNeighborIds, shortestPath } from "../src/index.ts";
import type { GLink, GNode } from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
const book = (id: string): GNode => ({ id, type: "book", label: id, clusters: [] });
const link = (id: string, s: string, t: string, type: GLink["type"]): GLink => ({ id, source: s, target: t, type, weight: 1 });

test("toGraph keeps nodes but excludes TRUSTS edges from the social graph", () => {
  const g = toGraph([person("me"), person("prov")], [link("t", "me", "prov", "TRUSTS")]);
  assert.equal(g.hasNode("me"), true);
  assert.equal(g.hasNode("prov"), true);
  assert.equal(g.hasEdge("me", "prov"), false);
});

test("visibleIds bounds to the viewer's ego radius", () => {
  const g = toGraph(
    [person("me"), person("f1"), book("b1")],
    [link("e1", "me", "f1", "FRIENDS_WITH"), link("e2", "f1", "b1", "READS")],
  );
  const r1 = visibleIds(g, "me", { radius: 1 });
  assert.ok(r1.has("me") && r1.has("f1"));
  assert.ok(!r1.has("b1"), "b1 is 2 hops out — beyond radius 1");
  assert.ok(visibleIds(g, "me", { radius: 2 }).has("b1"));
});

test("egoIds expands by hop depth", () => {
  const g = toGraph(
    [person("a"), person("b"), person("c")],
    [link("e1", "a", "b", "FRIENDS_WITH"), link("e2", "b", "c", "FRIENDS_WITH")],
  );
  assert.deepEqual([...egoIds(g, "a", 1)].sort(), ["a", "b"]);
  assert.ok(egoIds(g, "a", 2).has("c"));
});

test("commonNeighborIds finds the shared lens between two nodes", () => {
  const g = toGraph(
    [person("me"), person("f"), book("x")],
    [link("e1", "me", "x", "READS"), link("e2", "f", "x", "READS")],
  );
  assert.deepEqual(commonNeighborIds(g, "me", "f"), ["x"]);
});

test("shortestPath returns a route, or null when disconnected", () => {
  const g = toGraph(
    [person("a"), person("b"), person("c")],
    [link("e1", "a", "b", "FRIENDS_WITH"), link("e2", "b", "c", "FRIENDS_WITH")],
  );
  assert.deepEqual(shortestPath(g, "a", "c"), ["a", "b", "c"]);
  assert.equal(shortestPath(g, "a", "zzz"), null);
});
