/**
 * Phase 2 — invite / friend bridge.
 *
 * A friendship between two real users must show on BOTH canvases while staying
 * out of everyone else's. `addMutualFriendship` is the primitive the invite
 * accept-flow calls; these tests pin its mirrored-owned-edge shape.
 *
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { addMutualFriendship, linksForViewer } from "../src/index.ts";
import type { Dataset, GNode } from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });

function world(): Dataset {
  const nodes = [person("alice"), person("bob"), person("carol")];
  return { nodes, links: [], meId: "alice", recommendations: [], dismissed: [] };
}

test("mutual friendship is a mirrored pair of owned edges", () => {
  const d = addMutualFriendship(world(), "alice", "bob");
  const edges = d.links.filter((l) => l.type === "FRIENDS_WITH");
  assert.equal(edges.length, 2);
  assert.ok(edges.some((l) => l.userId === "alice" && l.scope === "user"));
  assert.ok(edges.some((l) => l.userId === "bob" && l.scope === "user"));
});

test("both friends see the bridge on their own canvas; a stranger sees neither", () => {
  const d = addMutualFriendship(world(), "alice", "bob");
  assert.ok(linksForViewer(d, "alice").some((l) => l.type === "FRIENDS_WITH"));
  assert.ok(linksForViewer(d, "bob").some((l) => l.type === "FRIENDS_WITH"));
  assert.equal(linksForViewer(d, "carol").filter((l) => l.type === "FRIENDS_WITH").length, 0);
});

test("re-accepting an invite is idempotent (no duplicate edges)", () => {
  let d = addMutualFriendship(world(), "alice", "bob");
  d = addMutualFriendship(d, "alice", "bob");
  d = addMutualFriendship(d, "bob", "alice"); // order-independent
  assert.equal(d.links.filter((l) => l.type === "FRIENDS_WITH").length, 2);
});

test("cannot befriend yourself", () => {
  assert.throws(() => addMutualFriendship(world(), "alice", "alice"), /yourself/);
});
