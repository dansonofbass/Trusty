/**
 * Decision Journey lifecycle (#35) — pure derivations over the append-only
 * event log: context merge, rec states, status, continue-vs-create matching.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  contextFromEvents,
  deriveJourneyStatus,
  deriveRecStates,
  describeJourneyEvent,
  journeyMatches,
  mergeJourneyContext,
  summarizeJourneyForAgent,
  type JourneyContext,
  type JourneyEvent,
} from "../src/index.ts";

const base: JourneyContext = { topic: "lawyer", preferences: [], constraints: [] };

test("mergeJourneyContext: refinement adds, never restarts", () => {
  let ctx = mergeJourneyContext(base, { geo: "maryland", preferences: ["persian speaking"] });
  ctx = mergeJourneyContext(ctx, { budget: "under $5,000", preferences: ["EB-2 NIW"] });
  assert.equal(ctx.topic, "lawyer");
  assert.equal(ctx.geo, "maryland");
  assert.equal(ctx.budget, "under $5,000");
  assert.deepEqual(ctx.preferences, ["persian speaking", "EB-2 NIW"]);
});

test("mergeJourneyContext: empty strings never clobber, lists dedup case-insensitively", () => {
  let ctx = mergeJourneyContext(base, { geo: "berlin" });
  ctx = mergeJourneyContext(ctx, { geo: "  ", preferences: ["Fast", "fast", "cheap"] });
  assert.equal(ctx.geo, "berlin");
  assert.deepEqual(ctx.preferences, ["Fast", "cheap"]);
});

test("contextFromEvents rebuilds the cached row from the log", () => {
  const events: JourneyEvent[] = [
    { kind: "created", at: 1 },
    { kind: "context", at: 2, detail: { patch: { geo: "yerevan" } } },
    { kind: "search", at: 3, detail: { topic: "lawyer", count: 2 } },
    { kind: "context", at: 4, detail: { patch: { language: "persian" } } },
  ];
  const ctx = contextFromEvents(base, events);
  assert.equal(ctx.geo, "yerevan");
  assert.equal(ctx.language, "persian");
});

test("deriveRecStates: last event wins per node; selection tracked", () => {
  const events: JourneyEvent[] = [
    { kind: "rec_suggested", at: 1, detail: { nodeId: "a", label: "Ana" } },
    { kind: "rec_suggested", at: 1, detail: { nodeId: "b", label: "Ben" } },
    { kind: "rec_saved", at: 2, detail: { nodeId: "a" } },
    { kind: "rec_dismissed", at: 3, detail: { nodeId: "b" } },
    { kind: "rec_selected", at: 4, detail: { nodeId: "a", label: "Ana" } },
  ];
  const st = deriveRecStates(events);
  assert.equal(st.get("a"), "selected");
  assert.equal(st.get("b"), "dismissed");
});

test("deriveJourneyStatus follows the lifecycle; reopen returns to open", () => {
  const events: JourneyEvent[] = [{ kind: "created", at: 1 }];
  assert.equal(deriveJourneyStatus(events), "open");
  events.push({ kind: "rec_selected", at: 2, detail: { nodeId: "a" } });
  assert.equal(deriveJourneyStatus(events), "decided");
  events.push({ kind: "outcome", at: 3, detail: { value: 1 } });
  assert.equal(deriveJourneyStatus(events), "completed");
  events.push({ kind: "closed", at: 4 });
  assert.equal(deriveJourneyStatus(events), "closed");
  events.push({ kind: "reopened", at: 5 });
  assert.equal(deriveJourneyStatus(events), "open");
});

test("journeyMatches: same topic continues; different geo separates only when both set", () => {
  const ctx: JourneyContext = { ...base, geo: "berlin" };
  assert.ok(journeyMatches(ctx, "lawyer"));
  assert.ok(journeyMatches(ctx, "lawyer", "Berlin"));
  assert.ok(!journeyMatches(ctx, "lawyer", "munich"));
  assert.ok(!journeyMatches(ctx, "dentist", "berlin"));
  assert.ok(journeyMatches(base, "lawyer", "anywhere-is-fine"));
});

test("describeJourneyEvent + summarizeJourneyForAgent are human/compact", () => {
  assert.match(
    describeJourneyEvent({ kind: "search", at: 1, detail: { topic: "lawyer", geo: "berlin", count: 1 } }),
    /Searched lawyer in berlin — 1 trusted path/,
  );
  const s = summarizeJourneyForAgent({
    id: "j1",
    title: "Immigration lawyer",
    status: "open",
    context: { ...base, geo: "maryland", preferences: ["EB-2 NIW"] },
    events: [{ kind: "rec_saved", at: 1, detail: { nodeId: "a", label: "Ana" } }],
  });
  assert.match(s, /journey j1 "Immigration lawyer" \(open\) topic=lawyer/);
  assert.match(s, /geo=maryland/);
  assert.match(s, /Ana\(a\):saved/);
});
