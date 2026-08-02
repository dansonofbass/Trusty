#!/usr/bin/env node
/**
 * Seed the Iranians-in-Armenia circles with real starter knowledge (idempotent).
 *
 * Why: an empty circle is a dead circle. A newcomer's FIRST question must
 * already have a credited, dated answer waiting — that is the whole promise
 * ("answers don't evaporate here"). Content is distilled from the community's
 * own public threads and attributed to a neutral "Community notes" account
 * until real members claim those topics; we never put words in a named
 * person's mouth.
 *
 * Run after seed-circles.mjs:
 *   docker compose exec -T graph-service node /workspace/scripts/seed-irham-knowledge.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const SEED_USER = process.env.SEED_USER ?? "irham-seed";
const HEADERS = {
  "content-type": "application/json",
  "x-user-id": SEED_USER,
  "x-user-name": encodeURIComponent("Community notes"),
  "x-user-admin": "1",
  "x-app": "irham",
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", "irham-seed-answers.json"), "utf8"));

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

const { circles } = await call("GET", "/api/circles");
const byName = new Map(circles.map((c) => [c.label.toLowerCase(), c]));

let posted = 0, saved = 0, skipped = 0;
for (const [circleName, answers] of Object.entries(fixture.circles)) {
  const circle = byName.get(circleName.toLowerCase());
  if (!circle) {
    console.warn(`  ! circle "${circleName}" not found — run seed-circles.mjs first`);
    continue;
  }
  // The seed account must be a member to post; joining is idempotent.
  if (!circle.mine) await call("POST", `/api/circles/${encodeURIComponent(circle.id)}/join`).catch(() => {});

  const existing = await call("GET", `/api/rooms/${encodeURIComponent(circle.roomId)}/answers`);
  const have = new Set((existing.answers ?? []).map((a) => a.body.slice(0, 60)));

  for (const a of answers) {
    if (have.has(a.body.slice(0, 60))) { skipped++; continue; }
    const msg = await call("POST", `/api/rooms/${encodeURIComponent(circle.roomId)}/messages`, { body: a.body });
    posted++;
    const id = msg?.message?.id ?? msg?.id;
    if (id) {
      await call("POST", `/api/rooms/${encodeURIComponent(circle.roomId)}/messages/${id}/save-answer`);
      saved++;
    }
  }
  console.log(`  ${circleName} ✓`);
}

console.log(`\nknowledge seed — ${posted} messages posted, ${saved} saved as answers, ${skipped} already present.`);
console.log(`Ask the assistant on irham: "What documents do I need for residency?"\n`);
