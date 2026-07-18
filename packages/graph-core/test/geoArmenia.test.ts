/**
 * Armenia geo scope + recommendation context taxonomy (pure data helpers).
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ARMENIA_CITIES,
  DEFAULT_GEO,
  GEO_OPTIONS,
  YEREVAN_DISTRICTS,
  contextsForTopic,
  geoLabel,
  isKnownGeo,
} from "../src/index.ts";

test("default scope is yerevan and every value is canonical lowercase", () => {
  assert.equal(DEFAULT_GEO, "yerevan");
  assert.ok(ARMENIA_CITIES.includes("yerevan"));
  for (const v of [...ARMENIA_CITIES, ...YEREVAN_DISTRICTS]) {
    assert.equal(v, v.toLowerCase(), `${v} must be lowercase`);
  }
});

test("GEO_OPTIONS groups Yerevan+districts first, cities second, no duplicate yerevan", () => {
  assert.equal(GEO_OPTIONS[0].options[0], "yerevan");
  assert.ok(GEO_OPTIONS[0].options.includes("kentron"));
  assert.ok(!GEO_OPTIONS[1].options.includes("yerevan"));
  assert.ok(GEO_OPTIONS[1].options.includes("gyumri"));
});

test("isKnownGeo accepts cities and districts, rejects the rest", () => {
  assert.ok(isKnownGeo("Yerevan"));
  assert.ok(isKnownGeo("nor nork"));
  assert.ok(!isKnownGeo("berlin"));
});

test("geoLabel humanizes canonical values", () => {
  assert.equal(geoLabel("yerevan"), "Yerevan");
  assert.equal(geoLabel("nor nork"), "Nor Nork");
  assert.equal(geoLabel("kanaker-zeytun"), "Kanaker-Zeytun");
});

test("contextsForTopic: topic-specific first, generic appended, deduped", () => {
  const r = contextsForTopic("restaurant");
  assert.equal(r[0].value, "date_night");
  assert.ok(r.some((c) => c.value === "budget_friendly")); // generic tail
  const values = r.map((c) => c.value);
  assert.equal(new Set(values).size, values.length, "no duplicates");
  // family_with_kids is both restaurant-specific and generic — appears once
  assert.equal(values.filter((v) => v === "family_with_kids").length, 1);
  // unknown topic → generic list
  assert.ok(contextsForTopic("nonsense").some((c) => c.value === "first_time"));
});
