/**
 * Geo distance — used to rank/filter place recommendations by "near me".
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { haversineKm } from "../src/index.ts";

test("haversineKm: zero for identical points", () => {
  assert.equal(haversineKm({ lat: 40.18, lng: 44.51 }, { lat: 40.18, lng: 44.51 }), 0);
});

test("haversineKm: symmetric + a known distance", () => {
  const yerevan = { lat: 40.1792, lng: 44.4991 };
  const tbilisi = { lat: 41.7151, lng: 44.8271 };
  const d = haversineKm(yerevan, tbilisi);
  // Yerevan↔Tbilisi great-circle is ~173 km.
  assert.ok(d > 165 && d < 180, `expected ~173km, got ${d.toFixed(1)}`);
  assert.ok(Math.abs(d - haversineKm(tbilisi, yerevan)) < 1e-9); // symmetric
});

test("haversineKm: short intra-city distance is small", () => {
  // ~0.01° lat ≈ 1.1 km
  const d = haversineKm({ lat: 40.18, lng: 44.51 }, { lat: 40.19, lng: 44.51 });
  assert.ok(d > 0.9 && d < 1.3, `got ${d.toFixed(2)}`);
});
