/**
 * Contribution Engine (issues #20/#21/#22) — the frozen guarantees:
 * impact not activity, lifecycle before value, quality over quantity,
 * consistency over bursts, history preserved, explainable, topic-scopable.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateContribution,
  explainContribution,
  contributionStage,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_STAGES,
  NON_CONTRIBUTION_ACTIVITY,
  type ContributionEvent,
  type ContributionStatus,
} from "../src/index.ts";

const DAY = 86_400_000;
const NOW = 1000 * DAY; // fixed reference time — deterministic

const ev = (
  kind: string,
  atMs: number,
  status: ContributionStatus = "validated",
  topic?: string,
): ContributionEvent => ({ kind, status, atMs, topic });

/* ------------------------- the hard rules (#21) ------------------------- */

test("FROZEN: plain activity NEVER earns contribution — unknown kinds are worth zero", () => {
  // Every forbidden activity from the spec, submitted as if it were an event.
  const events = NON_CONTRIBUTION_ACTIVITY.map((kind, i) => ev(kind, NOW - i * DAY, "accepted"));
  const s = aggregateContribution(events, { now: NOW });
  assert.equal(s.score, 0, "activity aggregates to exactly zero");
  assert.equal(s.events, 0, "no activity event is even counted");
  // And the registry itself never contains them.
  for (const kind of NON_CONTRIBUTION_ACTIVITY)
    assert.equal(CONTRIBUTION_KINDS[kind], undefined, `${kind} must not be rewardable`);
});

test("FROZEN: contribution has no trust/reputation/payment inputs — only evidence events", () => {
  // Structural: the API accepts events + time only. Two users with identical
  // evidence get identical scores regardless of anything else in the world.
  const events = [ev("recommendation_created", NOW - 5 * DAY)];
  const a = aggregateContribution(events, { now: NOW });
  const b = aggregateContribution([...events], { now: NOW });
  assert.deepEqual(a, b, "deterministic — same evidence, same score");
});

test("lifecycle: submission earns a fraction, validation earns full, rejection earns nothing", () => {
  const at = NOW - DAY;
  const recorded = aggregateContribution([ev("entity_correction", at, "recorded")], { now: NOW });
  const validated = aggregateContribution([ev("entity_correction", at, "validated")], { now: NOW });
  const rejected = aggregateContribution([ev("entity_correction", at, "rejected")], { now: NOW });
  assert.ok(recorded.score > 0, "a recorded suggestion has small provisional value");
  assert.ok(validated.score > recorded.score * 3, "validated is worth far more than recorded");
  assert.equal(rejected.score, 0, "rejected stays in history but counts for nothing");
});

/* ---------------------- quality over quantity (#22) ---------------------- */

test("quality beats quantity: a few validated outcomes on one rec beat a same-day flood of recs", () => {
  const flood: ContributionEvent[] = [];
  for (let i = 0; i < 50; i++) flood.push(ev("recommendation_created", NOW - DAY + i, "accepted"));
  const flooder = aggregateContribution(flood, { now: NOW });

  const quality = aggregateContribution(
    [
      ev("recommendation_created", NOW - 200 * DAY, "accepted"),
      ev("recommendation_validated", NOW - 150 * DAY),
      ev("recommendation_validated", NOW - 100 * DAY),
      ev("recommendation_validated", NOW - 50 * DAY),
      ev("recommendation_validated", NOW - 10 * DAY),
    ],
    { now: NOW },
  );
  assert.ok(
    quality.score > flooder.score,
    `one validated rec (${quality.score}) must beat 50 same-day generic recs (${flooder.score})`,
  );
});

test("burst damping: the nth same-kind event in a day is worth less; spread out, it is not", () => {
  const sameDay = aggregateContribution(
    [ev("outcome_recorded", NOW - DAY), ev("outcome_recorded", NOW - DAY + 1), ev("outcome_recorded", NOW - DAY + 2)],
    { now: NOW },
  );
  const spread = aggregateContribution(
    [ev("outcome_recorded", NOW - 3 * DAY), ev("outcome_recorded", NOW - 2 * DAY), ev("outcome_recorded", NOW - DAY)],
    { now: NOW },
  );
  assert.ok(spread.score > sameDay.score, "spreading the same work over days earns more");
});

test("validation weighs more than creation (reduces uncertainty)", () => {
  assert.ok(
    CONTRIBUTION_KINDS.recommendation_validated.baseValue >
      CONTRIBUTION_KINDS.recommendation_created.baseValue,
    "independent validation of a rec outweighs creating one",
  );
});

/* --------------------- consistency & history (#22) ---------------------- */

test("consistency: the same events spread across months beat a single burst month", () => {
  const monthly: ContributionEvent[] = [];
  for (let m = 0; m < 12; m++) monthly.push(ev("recommendation_created", NOW - m * 31 * DAY, "accepted"));
  const burst: ContributionEvent[] = [];
  for (let m = 0; m < 12; m++) burst.push(ev("recommendation_created", NOW - m * DAY, "accepted"));

  const consistent = aggregateContribution(monthly, { now: NOW });
  const bursty = aggregateContribution(burst, { now: NOW });
  assert.ok(consistent.consistency > bursty.consistency, "more active months → bigger multiplier");
  assert.ok(consistent.score > bursty.score, "two-year-style consistency wins overall");
});

test("contribution does not decay: old validated work keeps its lifetime value", () => {
  const old = aggregateContribution([ev("recommendation_validated", NOW - 900 * DAY)], { now: NOW });
  const fresh = aggregateContribution([ev("recommendation_validated", NOW - DAY)], { now: NOW });
  assert.equal(old.lifetime, fresh.lifetime, "lifetime component never decays");
  assert.ok(old.momentum < fresh.momentum, "momentum reflects recency");
  assert.ok(old.score > 0, "inactive contributors keep their history (recoverable)");
  assert.ok(fresh.score > old.score, "recent value still matters more overall");
});

test("diversity: improving different parts of the graph adds a small extra signal", () => {
  const at = (i: number) => NOW - (i + 1) * DAY;
  const diverse = aggregateContribution(
    [ev("recommendation_created", at(0), "accepted"), ev("outcome_recorded", at(1)), ev("entity_correction", at(2), "accepted"), ev("entity_maintenance", at(3), "accepted")],
    { now: NOW },
  );
  const narrow = aggregateContribution(
    [ev("recommendation_created", at(0), "accepted"), ev("recommendation_created", at(1), "accepted"), ev("recommendation_created", at(2), "accepted"), ev("recommendation_created", at(3), "accepted")],
    { now: NOW },
  );
  assert.ok(diverse.diversity > narrow.diversity, "four categories beat one on the diversity signal");
});

/* ----------------------- explainability & stages ------------------------ */

test("explanations reference real graph improvements, never bare points", () => {
  const s = aggregateContribution(
    [ev("recommendation_validated", NOW - DAY), ev("entity_correction", NOW - 2 * DAY, "accepted")],
    { now: NOW },
  );
  const phrases = explainContribution(s);
  assert.equal(phrases.length, 2);
  assert.ok(phrases.some((p) => p.includes("verified outcome")), "cites verified outcomes");
  assert.ok(phrases.some((p) => p.includes("correction")), "cites approved corrections");
  for (const p of phrases) assert.ok(!/point/i.test(p), "never phrased as points");
});

test("maturity stages progress monotonically and start at New Contributor", () => {
  assert.equal(contributionStage(0), "New Contributor");
  assert.equal(contributionStage(CONTRIBUTION_STAGES[CONTRIBUTION_STAGES.length - 1].min + 1), "Community Expert");
  let last = -1;
  for (const s of CONTRIBUTION_STAGES) {
    assert.ok(s.min > last, "stage thresholds strictly increase");
    last = s.min;
  }
});

/* ------------------------- topic-scoping (#22) -------------------------- */

test("topic-scoped contribution works without redesign (V1 default stays global)", () => {
  const events = [
    ev("recommendation_created", NOW - DAY, "accepted", "dentist"),
    ev("recommendation_validated", NOW - 2 * DAY, "validated", "dentist"),
    ev("recommendation_created", NOW - 3 * DAY, "accepted", "lawyer"),
  ];
  const global = aggregateContribution(events, { now: NOW });
  const dentist = aggregateContribution(events, { now: NOW, topic: "dentist" });
  const lawyer = aggregateContribution(events, { now: NOW, topic: "lawyer" });
  assert.equal(global.events, 3);
  assert.equal(dentist.events, 2);
  assert.equal(lawyer.events, 1);
  assert.ok(dentist.score > lawyer.score, "domain strength differs per topic");
});

/* ------------------------------ stability ------------------------------- */

test("score is stable and order-independent", () => {
  const events = [
    ev("outcome_recorded", NOW - 5 * DAY),
    ev("recommendation_created", NOW - 9 * DAY, "accepted"),
    ev("entity_correction", NOW - 30 * DAY, "accepted"),
  ];
  const a = aggregateContribution(events, { now: NOW });
  const b = aggregateContribution([...events].reverse(), { now: NOW });
  assert.deepEqual(a, b, "event order never changes the result");
});
