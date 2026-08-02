#!/usr/bin/env node
/**
 * Remove seeded/demo content so only REAL people and their data remain.
 *
 * What counts as real: a person node whose id looks like a Keycloak subject
 * (a UUID) — those are created by actual sign-ins. Everything else that came
 * from a fixture or crawl (mentors, sessions, squads, mock people, demo
 * places…) is demo content.
 *
 * SAFE BY DEFAULT — prints what it would delete and changes nothing:
 *   docker compose exec -T graph-service node /workspace/scripts/purge-demo-data.mjs
 *
 * Actually delete (asks for the magic word so it can't happen by accident):
 *   docker compose exec -T graph-service node /workspace/scripts/purge-demo-data.mjs --yes-delete
 *
 * Options:
 *   --keep-summit     keep summit content (squads, mentors, sessions, organizer)
 *   --keep-circles    keep circle nodes (their rooms/messages live in Postgres)
 *   --only=<t1,t2>    delete ONLY these entityTypes
 */
const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const HEADERS = {
  "content-type": "application/json",
  "x-user-id": process.env.SEED_USER ?? "purge-script",
  "x-user-admin": "1",
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => args.find((a) => a.startsWith(`${n}=`))?.split("=")[1];
const DRY = !flag("--yes-delete");
const only = val("--only")?.split(",").map((s) => s.trim()).filter(Boolean);

const SUMMIT_TYPES = ["mentor", "speaker", "investor", "session", "squad", "organizer", "startup"];
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function call(method, path, body) {
  const r = await fetch(`${GRAPH}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const graph = await call("GET", "/api/graph");
const nodes = graph.nodes ?? [];

const realPeople = nodes.filter((n) => n.type === "person" && isUuid(n.id));
const realIds = new Set(realPeople.map((n) => n.id));

const doomed = nodes.filter((n) => {
  if (realIds.has(n.id)) return false;                       // a signed-in human
  const et = n.entityType ?? "";
  if (only) return only.includes(et);
  if (flag("--keep-summit") && SUMMIT_TYPES.includes(et)) return false;
  if (flag("--keep-circles") && et === "circle") return false;
  return true;                                               // everything else is demo
});

const byType = {};
for (const n of doomed) byType[n.entityType ?? n.type] = (byType[n.entityType ?? n.type] ?? 0) + 1;

console.log(`\ngraph: ${nodes.length} nodes — ${realPeople.length} real people (kept)\n`);
console.log(`would delete ${doomed.length} nodes:`);
for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${t}`);
}
console.log("\nreal people kept:");
for (const p of realPeople) console.log(`  • ${p.label}`);

if (DRY) {
  console.log(`\nDRY RUN — nothing changed. Re-run with --yes-delete to apply.\n`);
  process.exit(0);
}

let done = 0, failed = 0;
for (const n of doomed) {
  try {
    await call("DELETE", `/api/admin/entities/${encodeURIComponent(n.id)}`);
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${doomed.length}`);
  } catch (e) {
    failed++;
    if (failed <= 5) console.warn(`  ! ${n.label}: ${e.message}`);
  }
}
console.log(`\ndeleted ${done} nodes${failed ? `, ${failed} failed` : ""}. Real users untouched.\n`);
