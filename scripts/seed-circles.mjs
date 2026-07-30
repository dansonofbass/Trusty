#!/usr/bin/env node
/**
 * Seed the Iranians-in-Armenia space (idempotent): the `irham` ontology app
 * row + its starter circles (Residency, Accounting & Tax, …). Circles are
 * created through the normal POST /api/circles route with `x-app: irham`, so
 * they behave exactly like user-created ones — the seed user is just the
 * first member; real members join from Discover.
 *
 *   docker compose exec -T graph-service node /workspace/scripts/seed-circles.mjs
 *   # or: GRAPH_URL=http://localhost:4001 node scripts/seed-circles.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const HEADERS = {
  "content-type": "application/json",
  "x-user-id": process.env.SEED_USER ?? "irham-seed",
  "x-user-name": "Trusty",
  "x-user-admin": "1",
  "x-app": "irham",
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", "circles-iran.json"), "utf8"));

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

console.log(`seeding space "${fixture.app.slug}" @ ${GRAPH}`);
await call("POST", "/api/admin/apps", fixture.app);
console.log(`  app ${fixture.app.slug} ✓`);

const { circles: existing } = await call("GET", "/api/circles");
const have = new Set(existing.map((c) => c.label.toLowerCase()));
let created = 0, skipped = 0;
for (const c of fixture.circles) {
  if (have.has(c.name.toLowerCase())) { skipped++; continue; }
  await call("POST", "/api/circles", c);
  created++;
  console.log(`  circle ${c.name} ✓`);
}
console.log(`circles — ${created} created, ${skipped} already present.`);
console.log(`Done. Front door: https://irham.<your-domain> (DNS + Caddy already configured).`);
