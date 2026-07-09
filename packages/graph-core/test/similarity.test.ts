/**
 * Semantic topic matching (Feature 9) — pure vector math + the trust-engine hook.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, topicsWithinThreshold, topicMatch } from "../src/index.ts";

test("cosineSimilarity: identical=1, orthogonal=0, opposite=-1, safe on degenerate", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0); // zero vector → 0, no NaN
  assert.equal(cosineSimilarity([1], [1, 2]), 0); // length mismatch → 0
  assert.ok(Math.abs(cosineSimilarity([1, 1], [2, 2]) - 1) < 1e-9); // scale-invariant
});

test("topicsWithinThreshold returns similar topics, most-similar first", () => {
  const q = [1, 0, 0];
  const cands = [
    { topic: "orthodontist", vec: [0.9, 0.1, 0] }, // ~similar
    { topic: "plumber", vec: [0, 1, 0] }, // orthogonal
    { topic: "dentist", vec: [1, 0, 0] }, // identical
  ];
  const out = topicsWithinThreshold(q, cands, 0.6);
  assert.deepEqual(out, ["dentist", "orthodontist"]); // plumber excluded, sorted by sim
  assert.deepEqual(topicsWithinThreshold(q, cands, 0.999), ["dentist"]); // tighter threshold
});

test("topicMatch honors expandedTopics without breaking equality/parent/geo", () => {
  // baseline equality + parent still work with no expansion
  assert.equal(topicMatch({ topic: "dentist" }, { topic: "dentist" }), true);
  assert.equal(topicMatch({ topic: "cafe" }, { topic: "food" }), true);
  assert.equal(topicMatch({ topic: "orthodontist" }, { topic: "dentist" }), false);

  // with a semantic expansion, the orthodontist edge now matches a dentist query
  assert.equal(
    topicMatch({ topic: "orthodontist" }, { topic: "dentist", expandedTopics: ["orthodontist"] }),
    true,
  );
  // geo still excludes when both differ, even via expansion
  assert.equal(
    topicMatch(
      { topic: "orthodontist", geo: "yerevan" },
      { topic: "dentist", geo: "tbilisi", expandedTopics: ["orthodontist"] },
    ),
    false,
  );
});
