/**
 * Phase 1 — per-user graphs over a shared entity layer.
 *
 * graph-core is pure functions and everything depends on it, so this is where
 * the scope model earns its keep. These tests pin the three invariants that
 * make the overlay real:
 *   1. personal-edge mutations are OWNED (scope:"user" + userId),
 *   2. a viewer's canvas is global ∪ their own edges — never a stranger's,
 *   3. consensus PROMOTION bridges a private assertion into the global catalog.
 *
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  addEdge,
  removeEdge,
  addTrustEdge,
  addUserEntityLink,
  linksForViewer,
  viewForUser,
  buildDataset,
  ENTITY_LINK_PROMOTION_THRESHOLD,
} from "../src/index.ts";
import type { Dataset, GLink, GNode } from "../src/index.ts";

const person = (id: string, label = id): GNode => ({ id, type: "person", label, clusters: [] });
const book = (id: string, label = id): GNode => ({ id, type: "book", label, clusters: [] });

/** A tiny union graph: two real users, a seed person, two books, one global fact. */
function union(): Dataset {
  const nodes: GNode[] = [
    person("userA", "A"),
    person("userB", "B"),
    person("px", "Seed X"),
    book("b1", "Sapiens"),
    book("b2", "سیپینس"), // same book, other language — a promotion candidate
  ];
  // A shared/global fact everyone can see (no scope).
  const links: GLink[] = [
    { id: "g1", source: "px", target: "b1", type: "READS", weight: 1 },
  ];
  return { nodes, links, meId: "userA", recommendations: [], dismissed: [] };
}

const idsOf = (links: GLink[]) => links.map((l) => l.id).sort();

test("personal edge is owned: scope:user + userId, not global", () => {
  const d = addEdge(union(), "userA", "b1", "userA");
  const edge = d.links.find((l) => l.source === "userA" && l.target === "b1");
  assert.ok(edge, "edge was created");
  assert.equal(edge!.scope, "user");
  assert.equal(edge!.userId, "userA");
});

test("no owner ⇒ global fact (seed / connector path unchanged)", () => {
  const d = addEdge(union(), "px", "b2"); // no owner arg
  const edge = d.links.find((l) => l.source === "px" && l.target === "b2");
  assert.ok(edge);
  assert.equal(edge!.scope, undefined); // treated as global by linksForViewer
});

test("canvas isolation: a viewer sees global ∪ own, never a stranger's edges", () => {
  let d = union();
  d = addEdge(d, "userA", "b1", "userA"); // A reads b1 (private)
  d = addEdge(d, "userB", "b2", "userB"); // B reads b2 (private)

  const aLinks = linksForViewer(d, "userA");
  const bLinks = linksForViewer(d, "userB");

  // Both see the global fact g1.
  assert.ok(aLinks.some((l) => l.id === "g1"));
  assert.ok(bLinks.some((l) => l.id === "g1"));
  // A sees own edge, not B's; and vice-versa.
  assert.ok(aLinks.some((l) => l.userId === "userA"));
  assert.ok(!aLinks.some((l) => l.userId === "userB"));
  assert.ok(bLinks.some((l) => l.userId === "userB"));
  assert.ok(!bLinks.some((l) => l.userId === "userA"));
});

test("viewForUser marks the root isMe and narrows links to the viewer's slice", () => {
  let d = union();
  d = addEdge(d, "userA", "b1", "userA");
  d = addEdge(d, "userB", "b2", "userB");

  const va = viewForUser(d, "userA");
  assert.equal(va.meId, "userA");
  assert.equal(va.nodes.find((n) => n.id === "userA")?.isMe, true);
  assert.equal(va.nodes.find((n) => n.id === "userB")?.isMe, undefined);
  assert.ok(!va.links.some((l) => l.userId === "userB"), "B's private edge is filtered out");
});

test("trust edges are private too: only the truster's own view carries them", () => {
  const d = addTrustEdge(union(), "userA", "px", { topic: "broker" }, { now: 1 });
  const trustEdge = d.links.find((l) => l.type === "TRUSTS");
  assert.ok(trustEdge);
  assert.equal(trustEdge!.scope, "user");
  assert.equal(trustEdge!.userId, "userA");
  assert.ok(linksForViewer(d, "userA").some((l) => l.type === "TRUSTS"));
  assert.ok(!linksForViewer(d, "userB").some((l) => l.type === "TRUSTS"));
});

test("removeEdge only unlinks the caller's own edge, never a stranger's or a global fact", () => {
  let d = union();
  d = addEdge(d, "userA", "b1", "userA");
  d = addEdge(d, "userB", "b1", "userB"); // both read b1 privately

  // B unfriends/unreads b1 — A's edge and the global g1 survive.
  d = removeEdge(d, "userB", "b1", "userB");
  assert.ok(!d.links.some((l) => l.userId === "userB"), "B's edge gone");
  assert.ok(d.links.some((l) => l.userId === "userA"), "A's edge survives");
  assert.ok(d.links.some((l) => l.id === "g1"), "global fact survives");
});

test("same viewer can't double-add; two users each keep their own edge", () => {
  let d = union();
  d = addEdge(d, "userA", "b1", "userA");
  const after = addEdge(d, "userA", "b1", "userA"); // idempotent for A
  assert.equal(
    after.links.filter((l) => l.userId === "userA" && l.target === "b1").length,
    1,
  );
  const withB = addEdge(after, "userB", "b1", "userB");
  assert.equal(
    withB.links.filter((l) => l.target === "b1" && l.scope === "user").length,
    2,
    "A and B each own a distinct private edge to b1",
  );
});

test("promotion bridge: consensus flips a private assertion into the global catalog", () => {
  assert.equal(ENTITY_LINK_PROMOTION_THRESHOLD, 2);
  let d = union();
  // A asserts b1 SAME_AS b2 — private to A.
  d = addUserEntityLink(d, "userA", "b1", "b2", "SAME_AS");
  let link = d.links.find((l) => l.type === "SAME_AS");
  assert.ok(link);
  assert.equal(link!.scope, "user");
  assert.ok(!linksForViewer(d, "userB").some((l) => l.type === "SAME_AS"), "B can't see A's private link yet");

  // B independently asserts the same pair — threshold reached ⇒ promoted global.
  d = addUserEntityLink(d, "userB", "b1", "b2", "SAME_AS");
  link = d.links.find((l) => l.type === "SAME_AS");
  assert.equal(link!.scope, "global");
  assert.ok((link!.supporters ?? []).includes("userA"));
  assert.ok((link!.supporters ?? []).includes("userB"));
  // Now every viewer sees it.
  assert.ok(linksForViewer(d, "userA").some((l) => l.type === "SAME_AS"));
  assert.ok(linksForViewer(d, "userB").some((l) => l.type === "SAME_AS"));
});

test("seed world stays global: a fresh viewer inherits the shared catalog", () => {
  const d = buildDataset(2026);
  // Nothing in the seed is user-scoped — the whole demo world is shared ground.
  assert.ok(!d.links.some((l) => l.scope === "user"), "seed emits no private edges");
  const strangerView = viewForUser(d, "me");
  assert.equal(strangerView.links.length, d.links.length, "all seed links visible");
});
