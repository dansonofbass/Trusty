/**
 * Listen — the recommendation-permission relationship (issues #6/#7).
 * The frozen guarantees: never trust, directional, capacity-bounded, earned.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  addListenEdge,
  removeListenEdge,
  listeningTo,
  listenersOf,
  activeListenCount,
  isListening,
  listenCapacity,
  recommendationsFromListened,
  addTrustEdge,
  createRecommendation,
  computeTrustRecommendations,
  type Dataset,
  type GNode,
} from "../src/index.ts";

const person = (id: string): GNode => ({ id, type: "person", label: id, clusters: [] });
const world = (): Dataset => ({
  nodes: [person("me"), person("speaker"), person("other"), person("prov")],
  links: [],
  meId: "me",
  recommendations: [],
});
const BIG = 100; // ample capacity for tests not about capacity

/* ----------------------------- the hard rule ---------------------------- */

test("FROZEN: listening never creates trust — no trust path, no recommendation", () => {
  // `speaker` trusts a provider on lawyer. I listen to `speaker` but do NOT trust them.
  let d = addTrustEdge(world(), "speaker", "prov", { topic: "lawyer" }, { now: 1, confidence: 0.9 });
  d = addListenEdge(d, "me", "speaker", BIG);
  const recs = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "lawyer" });
  assert.equal(
    recs.find((r) => r.nodeId === "prov"),
    undefined,
    "a listened-to person's trust must NOT transfer to me",
  );
});

test("FROZEN: listening does not change an existing trust score or path", () => {
  const base = (() => {
    const d0 = world();
    d0.links.push({ id: "fw", source: "me", target: "speaker", type: "FRIENDS_WITH", weight: 1 });
    return addTrustEdge(d0, "speaker", "prov", { topic: "lawyer" }, { now: 1, confidence: 0.9 });
  })();
  const withListen = addListenEdge(base, "me", "speaker", BIG);

  const score = (d: Dataset) =>
    computeTrustRecommendations(d.nodes, d.links, "me", { topic: "lawyer" }).find(
      (r) => r.nodeId === "prov",
    )!;
  const a = score(base);
  const b = score(withListen);
  assert.equal(a.score, b.score, "trust score unchanged by a listen edge");
  assert.deepEqual(
    a.trustPath!.map((h) => `${h.from}->${h.to}:${h.kind}`),
    b.trustPath!.map((h) => `${h.from}->${h.to}:${h.kind}`),
    "trust path unchanged by a listen edge",
  );
});

/* ---------------------------- directionality ---------------------------- */

test("listening is directional and never reciprocal", () => {
  const d = addListenEdge(world(), "me", "speaker", BIG);
  assert.deepEqual(listeningTo(d, "me"), ["speaker"]);
  assert.deepEqual(listeningTo(d, "speaker"), [], "acceptance does not make them listen back");
  assert.deepEqual(listenersOf(d, "speaker"), ["me"]);
  assert.ok(isListening(d, "me", "speaker"));
  assert.ok(!isListening(d, "speaker", "me"));
});

test("addListenEdge is idempotent, rejects self-listening, frees on remove", () => {
  let d = addListenEdge(world(), "me", "speaker", BIG);
  d = addListenEdge(d, "me", "speaker", BIG); // idempotent
  assert.equal(activeListenCount(d, "me"), 1);
  assert.throws(() => addListenEdge(d, "me", "me", BIG), /yourself/);
  d = removeListenEdge(d, "me", "speaker");
  assert.equal(activeListenCount(d, "me"), 0, "unlistening frees the slot");
});

/* ------------------------------- capacity ------------------------------- */

test("listen capacity is a bounded, EARNED resource — never bought", () => {
  const cfg = { baseSlots: 5, contributionPerSlot: 5, maxSlots: 50 };
  assert.equal(listenCapacity(0, cfg), 5, "everyone starts with the base slots");
  assert.equal(listenCapacity(4, cfg), 5, "partial contribution earns nothing yet");
  assert.equal(listenCapacity(5, cfg), 6, "contribution earns a slot");
  assert.equal(listenCapacity(50, cfg), 15);
  assert.equal(listenCapacity(100000, cfg), 50, "hard ceiling");
  assert.equal(listenCapacity(-10, cfg), 5, "negative contribution never reduces below base");
});

test("a listener at capacity cannot open another listen", () => {
  let d = addListenEdge(world(), "me", "speaker", 1); // capacity of exactly 1
  assert.throws(() => addListenEdge(d, "me", "other", 1), /capacity/);
  // freeing a slot lets a new one through
  d = removeListenEdge(d, "me", "speaker");
  d = addListenEdge(d, "me", "other", 1);
  assert.deepEqual(listeningTo(d, "me"), ["other"]);
});

/* ---------------------------- what it unlocks --------------------------- */

test("listening makes the speaker's recommendations ELIGIBLE (visible, not trusted)", () => {
  let d = createRecommendation(world(), {
    id: "rec1",
    authorId: "speaker",
    targetId: "prov",
    topic: "lawyer",
    createdAt: 1,
  });
  d = createRecommendation(d, {
    id: "rec2",
    authorId: "other", // NOT listened to
    targetId: "prov",
    topic: "lawyer",
    createdAt: 2,
  });
  // Before listening: nothing is eligible.
  assert.deepEqual(recommendationsFromListened(d, "me"), []);

  d = addListenEdge(d, "me", "speaker", BIG);
  const eligible = recommendationsFromListened(d, "me").map((n) => n.id);
  assert.deepEqual(eligible, ["rec1"], "only the listened-to author's recommendation is eligible");

  // …and it still confers no trust.
  const recs = computeTrustRecommendations(d.nodes, d.links, "me", { topic: "lawyer" });
  assert.equal(recs.find((r) => r.nodeId === "prov"), undefined);
});

test("eligible recommendations can be narrowed by topic", () => {
  let d = createRecommendation(world(), {
    id: "rec1", authorId: "speaker", targetId: "prov", topic: "lawyer", createdAt: 1,
  });
  d = createRecommendation(d, {
    id: "rec2", authorId: "speaker", targetId: "prov", topic: "dentist", createdAt: 2,
  });
  d = addListenEdge(d, "me", "speaker", BIG);
  assert.deepEqual(recommendationsFromListened(d, "me", "dentist").map((n) => n.id), ["rec2"]);
});
