/**
 * Ontology — entity creation + schema validation (the provider catalog).
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createEntity,
  updateEntity,
  validateEntityProperties,
  entityTypeById,
  entityTypesByDomain,
  topicForEntityType,
} from "../src/index.ts";
import type { Dataset } from "../src/index.ts";

const base = (): Dataset => ({ nodes: [], links: [], meId: "me", recommendations: [] });

test("createEntity: a professional is a person, figure, carries entityType + topic", () => {
  const { dataset, nodeId } = createEntity(base(), {
    entityType: "dentist",
    label: "Dr. Sarkisyan",
    properties: {},
    now: 1,
  });
  const n = dataset.nodes.find((x) => x.id === nodeId)!;
  assert.equal(n.type, "person");
  assert.equal(n.figure, true);
  assert.equal(n.entityType, "dentist");
  assert.equal(topicForEntityType("dentist"), "dentist");
});

test("createEntity: a place is a location, not a figure", () => {
  const { dataset, nodeId } = createEntity(base(), {
    entityType: "restaurant",
    label: "Lavash",
    properties: {},
    now: 2,
  });
  const n = dataset.nodes.find((x) => x.id === nodeId)!;
  assert.equal(n.type, "location");
  assert.equal(n.figure, undefined);
});

test("createEntity rejects an empty name and an unknown type", () => {
  assert.throws(() => createEntity(base(), { entityType: "dentist", label: "   ", properties: {}, now: 1 }), /name/);
  assert.throws(() => createEntity(base(), { entityType: "__nope__", label: "x", properties: {}, now: 1 }), /unknown entity type/);
});

test("validateEntityProperties: coerces numbers, drops unknown keys + invalid selects", () => {
  const def = entityTypeById("property");
  assert.ok(def, "the real_estate 'property' type exists");
  const numField = def!.fields.find((f) => f.type === "number" || f.type === "money");
  const selField = def!.fields.find((f) => f.type === "select" && (f.options?.length ?? 0) > 0);

  const raw: Record<string, unknown> = { __unknown__: "drop me" };
  if (numField) raw[numField.key] = "42";
  const out = validateEntityProperties("property", raw);
  assert.equal(out.__unknown__, undefined); // keys not in the schema are stripped
  if (numField) assert.equal(out[numField.key], 42); // string coerced to number

  if (selField) {
    assert.equal(validateEntityProperties("property", { [selField.key]: "___invalid___" })[selField.key], undefined);
    const good = selField.options![0];
    assert.equal(validateEntityProperties("property", { [selField.key]: good })[selField.key], good);
  }
});

test("restaurant carries amenities + meal_types; multiselects filter unknown options", () => {
  const def = entityTypeById("restaurant")!;
  assert.ok(def.fields.some((f) => f.key === "amenities" && f.type === "multiselect"));
  assert.ok(def.fields.some((f) => f.key === "meal_types" && f.type === "multiselect"));

  const out = validateEntityProperties("restaurant", {
    amenities: ["wifi", "outdoor_seating", "__nope__"],
    meal_types: ["dinner", "brunch", "__bogus__"],
  });
  assert.deepEqual(out.amenities, ["wifi", "outdoor_seating"]); // unknown option dropped
  assert.deepEqual(out.meal_types, ["dinner", "brunch"]);
});

test("cafe also carries amenities + meal_types", () => {
  const def = entityTypeById("cafe")!;
  assert.ok(def.fields.some((f) => f.key === "amenities"));
  assert.ok(def.fields.some((f) => f.key === "meal_types"));
});

test("updateEntity merges a validated patch and refreshes sub", () => {
  const { dataset, nodeId } = createEntity(base(), {
    entityType: "restaurant",
    label: "Old Name",
    properties: { cuisine: ["italian"], price_range: "$$" },
    now: 1,
  });
  const next = updateEntity(dataset, {
    id: nodeId,
    label: "New Name",
    properties: { amenities: ["wifi", "__nope__"], price_range: "$$$" },
    now: 2,
  });
  const n = next.nodes.find((x) => x.id === nodeId)!;
  assert.equal(n.label, "New Name");
  assert.deepEqual(n.properties!.cuisine, ["italian"]); // untouched key preserved (merge)
  assert.equal(n.properties!.price_range, "$$$"); // overwritten
  assert.deepEqual(n.properties!.amenities, ["wifi"]); // invalid option dropped
});

test("updateEntity rejects unknown node / non-entity", () => {
  assert.throws(() => updateEntity(base(), { id: "nope", now: 1 }), /unknown node/);
});

test("entityTypesByDomain groups non-empty domains", () => {
  const groups = entityTypesByDomain();
  assert.ok(groups.length > 0);
  assert.ok(groups.every((g) => g.types.length > 0));
});
