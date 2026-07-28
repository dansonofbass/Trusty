#!/usr/bin/env node
/**
 * Seed the Seaside Startup Summit ontology + base entities (idempotent).
 *
 * Talks DIRECTLY to graph-service (inside the compose network or via a
 * tunneled port) using the BFF-style identity headers — run it next to the
 * stack, not from the public internet:
 *
 *   docker compose exec -T graph-service node /workspace/scripts/seed-summit.mjs
 *   # or: GRAPH_URL=http://localhost:4001 node scripts/seed-summit.mjs
 *
 * Re-running is safe: apps/types/relations upsert; entities are skipped when a
 * node with the same label already exists.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const HEADERS = {
  "content-type": "application/json",
  "x-user-id": process.env.SEED_USER ?? "summit-seed",
  "x-user-admin": "1",
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", "summit-ontology.json"), "utf8"));

async function call(method, path, body) {
  const r = await fetch(`${GRAPH}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const app = fixture.app;
console.log(`seeding app "${app.slug}" @ ${GRAPH}`);
await call("POST", "/api/admin/apps", app);

for (const t of fixture.entityTypes) {
  await call("POST", `/api/admin/apps/${app.slug}/entity-types`, t);
  console.log(`  type ${t.id} ✓`);
}
for (const rel of fixture.relations ?? []) {
  await call("POST", `/api/admin/apps/${app.slug}/relations`, rel);
  console.log(`  relation ${rel.id} ✓`);
}

// Entities: skip labels that already exist (idempotence without a dedupe API).
const graph = await call("GET", "/api/graph");
const existing = new Set(graph.nodes.map((n) => n.label.toLowerCase()));
let created = 0, skipped = 0;
for (const e of fixture.entities ?? []) {
  if (existing.has(e.label.toLowerCase())) { skipped++; continue; }
  await call("POST", "/api/entity", e);
  created++;
  console.log(`  entity ${e.label} ✓`);
}
console.log(`fixture entities — ${created} created, ${skipped} already present.`);

// Crawled agenda data (mentors + sessions) — produced by crawl-summit.mjs.
try {
  const data = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", "summit-data.json"), "utf8"));
  const fresh = data.rows.filter((r) => !existing.has(r.label.toLowerCase()));
  if (fresh.length) {
    const r = await call("POST", "/api/admin/summit/import", { rows: fresh });
    console.log(`agenda import — ${r.created ?? fresh.length} created, ${(r.errors ?? []).length} errors, ${data.rows.length - fresh.length} already present.`);
  } else {
    console.log("agenda import — everything already present.");
  }
} catch (e) {
  if (e.code === "ENOENT") console.log("no summit-data.json — run scripts/crawl-summit.mjs first for mentors+agenda.");
  else throw e;
}
