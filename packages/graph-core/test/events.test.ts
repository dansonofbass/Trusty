/**
 * Connector ingestion contract — the enabling change for places catalogs.
 * A connector must be able to upsert a real ontology entity (restaurant) with
 * validated properties + coordinates + provenance, idempotently by id.
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { upsertNode } from "../src/index.ts";
import type { Dataset } from "../src/index.ts";

const empty = (): Dataset => ({ nodes: [], links: [], meId: "system", recommendations: [] });

test("upsertNode creates a restaurant with entityType, properties, coords, provenance", () => {
  const d = upsertNode(empty(), {
    id: "place_osm_1",
    type: "location",
    label: "Lavash",
    entityType: "restaurant",
    properties: { cuisine: ["armenian", "italian"], price_range: "$$", geo: "yerevan" },
    lat: 40.18,
    lng: 44.51,
    source: "osm",
    externalId: "node/1",
  });
  const n = d.nodes.find((x) => x.id === "place_osm_1")!;
  assert.equal(n.type, "location");
  assert.equal(n.entityType, "restaurant");
  assert.deepEqual(n.properties!.cuisine, ["armenian", "italian"]);
  assert.equal(n.properties!.price_range, "$$");
  assert.equal(n.lat, 40.18);
  assert.equal(n.lng, 44.51);
  assert.equal(n.source, "osm");
  assert.equal(n.externalId, "node/1");
});

test("upsertNode validates properties against the ontology (drops invalid options + unknown keys)", () => {
  const d = upsertNode(empty(), {
    id: "place_osm_2",
    type: "location",
    label: "X",
    entityType: "restaurant",
    properties: { cuisine: ["armenian", "__nope__"], bogus_field: "drop me" },
  });
  const n = d.nodes.find((x) => x.id === "place_osm_2")!;
  assert.deepEqual(n.properties!.cuisine, ["armenian"]); // invalid multiselect option filtered
  assert.equal(n.properties!.bogus_field, undefined); // key not in the schema dropped
});

test("upsertNode carries photos and keeps only well-formed http(s) URLs", () => {
  const d = upsertNode(empty(), {
    id: "place_osm_3",
    type: "location",
    label: "Photogenic",
    entityType: "restaurant",
    photos: [
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=800",
      "http://example.com/b.jpg",
      "ftp://bad/c.jpg", // dropped — not http(s)
      "not a url", // dropped
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=800", // dedup
    ],
  });
  const n = d.nodes.find((x) => x.id === "place_osm_3")!;
  assert.deepEqual(n.photos, [
    "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=800",
    "http://example.com/b.jpg",
  ]);
});

test("upsertNode with no valid photos leaves photos undefined (merge-safe)", () => {
  let d = upsertNode(empty(), {
    id: "place_osm_4",
    type: "location",
    label: "Has Photo",
    photos: ["https://x.test/p.jpg"],
  });
  // A later upsert without photos must not wipe the existing ones.
  d = upsertNode(d, { id: "place_osm_4", type: "location", label: "Has Photo", photos: ["nope"] });
  const n = d.nodes.find((x) => x.id === "place_osm_4")!;
  assert.deepEqual(n.photos, ["https://x.test/p.jpg"]);
});

test("re-upserting the same id merges (no duplicate, updates fields)", () => {
  let d = upsertNode(empty(), {
    id: "place_osm_1",
    type: "location",
    label: "Old Name",
    entityType: "restaurant",
    properties: { price_range: "$" },
    lat: 1,
    lng: 2,
  });
  d = upsertNode(d, {
    id: "place_osm_1",
    type: "location",
    label: "New Name",
    entityType: "restaurant",
    properties: { price_range: "$$$" },
    lat: 3,
    lng: 4,
  });
  assert.equal(d.nodes.filter((x) => x.id === "place_osm_1").length, 1);
  const n = d.nodes.find((x) => x.id === "place_osm_1")!;
  assert.equal(n.label, "New Name");
  assert.equal(n.properties!.price_range, "$$$");
  assert.equal(n.lat, 3);
});
