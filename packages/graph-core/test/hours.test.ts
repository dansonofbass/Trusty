/**
 * OSM opening_hours "open now?" — the restaurant-detail Open/Closed badge.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isOpenNow, weeklyHours } from "../src/index.ts";

// A fixed reference moment: Wednesday 2024-01-10, 14:30 local.
const wed1430 = new Date(2024, 0, 10, 14, 30);
const wed2330 = new Date(2024, 0, 10, 23, 30);
const sun1000 = new Date(2024, 0, 7, 10, 0);

test("24/7 is always open; empty/garbage is unknown", () => {
  assert.equal(isOpenNow("24/7", wed1430), true);
  assert.equal(isOpenNow("", wed1430), null);
  assert.equal(isOpenNow(undefined, wed1430), null);
  assert.equal(isOpenNow("by appointment", wed1430), null);
});

test("simple Mo-Su range", () => {
  assert.equal(isOpenNow("Mo-Su 09:00-23:00", wed1430), true);
  assert.equal(isOpenNow("Mo-Su 09:00-23:00", wed2330), false); // 23:30 > 23:00
  assert.equal(isOpenNow("Mo-Su 10:00-24:00", wed2330), true); // 24:00 = midnight
});

test("day-specific rules", () => {
  // Wed is within Mo-Fr; Sunday rule doesn't apply Wed.
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", wed1430), true);
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", sun1000), false); // Su off
  // A rule that doesn't cover today at all → unknown (null), not "closed".
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", sun1000), null);
});

test("multiple ranges in a day (split shift)", () => {
  assert.equal(isOpenNow("Mo-Su 09:00-14:00,17:00-22:00", wed1430), false); // 14:30 is in the gap
  assert.equal(isOpenNow("Mo-Su 09:00-14:00,17:00-22:00", new Date(2024, 0, 10, 18, 0)), true);
});

test("weeklyHours: same range every day, midnight formatted 12:00 AM", () => {
  const wk = weeklyHours("Mo-Su 08:30-24:00");
  assert.equal(wk.length, 7);
  assert.equal(wk[0].code, "Mo");
  assert.equal(wk[0].label, "Monday");
  assert.deepEqual(wk[0].ranges, ["8:30 AM - 12:00 AM"]);
  assert.deepEqual(wk[6].ranges, ["8:30 AM - 12:00 AM"]); // Sunday
});

test("weeklyHours: 24/7 → every day 'Open 24 hours'", () => {
  const wk = weeklyHours("24/7");
  assert.equal(wk.length, 7);
  assert.ok(wk.every((d) => d.ranges[0] === "Open 24 hours"));
});

test("weeklyHours: day-specific rules + closed day + split shift", () => {
  const wk = weeklyHours("Mo-Fr 09:00-18:00; Sa 10:00-14:00,17:00-22:00; Su off");
  const by = Object.fromEntries(wk.map((d) => [d.code, d.ranges]));
  assert.deepEqual(by.We, ["9:00 AM - 6:00 PM"]);
  assert.deepEqual(by.Sa, ["10:00 AM - 2:00 PM", "5:00 PM - 10:00 PM"]);
  assert.deepEqual(by.Su, []); // closed ⇒ empty ranges
});

test("weeklyHours: unparseable / empty → empty array (caller falls back)", () => {
  assert.deepEqual(weeklyHours("by appointment"), []);
  assert.deepEqual(weeklyHours(""), []);
  assert.deepEqual(weeklyHours(undefined), []);
});
