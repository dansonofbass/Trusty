/**
 * Unified Composer intent detection (#29) — the frozen guarantees:
 * no modes, mixed intent per sentence, natural language first,
 * everything defaults to a private note.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeComposerText } from "../src/index.ts";

test("search intent: 'I need / looking for' phrasing", () => {
  const a = analyzeComposerText("I need an immigration lawyer for a family visa case");
  assert.equal(a.primary, "search");
  assert.ok(a.confidence >= 0.8);
  assert.ok(a.topics.includes("lawyer"), "topic detected from taxonomy");
  assert.ok(a.topics.includes("immigration"));
});

test("question phrasing counts as search-like", () => {
  const a = analyzeComposerText("Who is a good dentist around here?");
  assert.ok(a.primary === "search" || a.primary === "question");
  assert.ok(a.topics.includes("dentist"));
});

test("recommendation intent: 'I highly recommend'", () => {
  const a = analyzeComposerText("I highly recommend Maria's accountant, super precise with taxes");
  assert.equal(a.primary, "recommendation");
  assert.ok(a.topics.includes("accountant"));
});

test("experience intent: past-tense usage", () => {
  const a = analyzeComposerText("I hired the electrician from the market street office last month");
  assert.equal(a.primary, "experience");
  assert.ok(a.topics.includes("electrician"));
});

test("decision update: 'I went with'", () => {
  const a = analyzeComposerText("After comparing three brokers I went with the second one");
  assert.equal(a.primary, "decision_update");
  assert.ok(a.topics.includes("broker"));
});

test("FROZEN: mixed intent — the RFC's own example splits per sentence", () => {
  const a = analyzeComposerText(
    "I am looking for an immigration lawyer. Also, I recently had a great experience with my accountant.",
  );
  assert.equal(a.mixed, true, "two confident intents coexist");
  const kinds = a.intents.map((g) => g.intent);
  assert.ok(kinds.includes("search"), "first sentence = search");
  assert.ok(kinds.includes("experience"), "second sentence = experience");
  assert.ok(a.topics.includes("lawyer") && a.topics.includes("accountant"));
});

test("FROZEN: plain thinking defaults to a PRIVATE note, never a publish action", () => {
  const a = analyzeComposerText("Comparing mortgage rates this week, feeling unsure about fixed vs variable");
  assert.equal(a.primary, "note");
  assert.ok(a.confidence < 0.5, "low-confidence default — the workspace catches it");
});

test("explicit note prefix wins with high confidence", () => {
  const a = analyzeComposerText("Remember to ask Sara about the notary");
  assert.equal(a.primary, "note");
  assert.ok(a.confidence >= 0.9);
});

test("empty input is unknown, deterministic", () => {
  assert.deepEqual(analyzeComposerText("   "), {
    primary: "unknown", confidence: 0, intents: [], mixed: false, topics: [],
  });
  const a = analyzeComposerText("I need a plumber");
  const b = analyzeComposerText("I need a plumber");
  assert.deepEqual(a, b);
});
