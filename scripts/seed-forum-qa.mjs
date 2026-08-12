#!/usr/bin/env node
/**
 * Seed question→answer threads into forum circles (idempotent).
 *
 * Why a Q&A pair and not a bare answer: a newcomer arrives with a QUESTION.
 * `seed-irham-knowledge.mjs` seeded answers as chat messages, which reads as
 * a wall of tips nobody asked. This posts the question as a real forum post,
 * answers it, and accepts the answer — so search, tags, and the public
 * /c/<circle>/p/<post> link all work the way they do for member content.
 *
 * Idempotency is by post TITLE within a circle: re-running never duplicates,
 * and a title you edit in the fixture creates a new thread (delete the old one
 * from the forum if that is not what you wanted).
 *
 *   docker compose exec -T graph-service node /workspace/scripts/seed-forum-qa.mjs
 *   DRY_RUN=1 node scripts/seed-forum-qa.mjs          # print the plan, change nothing
 *   FIXTURE=irham-residency-qa.json node scripts/seed-forum-qa.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const APP = process.env.APP ?? "irham";
const TOPIC = process.env.TOPIC ?? "پرسش‌های عمومی";
const FIXTURE = process.env.FIXTURE ?? "irham-residency-qa.json";
const DRY_RUN = process.env.DRY_RUN === "1";
const SEED_USER = process.env.SEED_USER ?? "irham-seed";

const HEADERS = {
  "content-type": "application/json",
  "x-user-id": SEED_USER,
  "x-user-name": encodeURIComponent("Community notes"),
  "x-user-admin": "1",
  "x-app": APP,
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", FIXTURE), "utf8"));

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

const enc = encodeURIComponent;
const norm = (s) => s.replace(/\s+/g, " ").trim();

console.log(`seeding Q&A from ${FIXTURE} → ${GRAPH} (app=${APP})${DRY_RUN ? "  [DRY RUN]" : ""}`);

const { circles } = await call("GET", "/api/circles");
const byLabel = new Map(circles.map((c) => [c.label.toLowerCase(), c]));

// Group the fixture by circle so we fetch each circle's state once.
const byCircle = new Map();
for (const item of fixture.items) {
  if (!byCircle.has(item.circle)) byCircle.set(item.circle, []);
  byCircle.get(item.circle).push(item);
}

let created = 0, skipped = 0, failed = 0;

for (const [label, items] of byCircle) {
  const circle = byLabel.get(label.toLowerCase());
  if (!circle) {
    console.warn(`  ! circle "${label}" not found — run seed-circles.mjs first (${items.length} item(s) skipped)`);
    failed += items.length;
    continue;
  }

  // Posting requires membership; joining is idempotent and harmless for admins.
  if (!circle.mine && !DRY_RUN) {
    await call("POST", `/api/circles/${enc(circle.id)}/join`).catch(() => {});
  }

  // Resolve the destination topic, creating it once if the circle has none.
  const { topics = [] } = await call("GET", `/api/circles/${enc(circle.id)}/topics`);
  let topic = topics.find((t) => norm(t.label) === norm(TOPIC)) ?? topics[0] ?? null;
  if (!topic && !DRY_RUN) {
    const r = await call("POST", `/api/circles/${enc(circle.id)}/topics`, { label: TOPIC, position: 0 })
      .catch((e) => { console.warn(`  ! could not create topic in ${label}: ${e.message}`); return null; });
    if (r?.id) topic = { id: r.id, label: TOPIC };
  }

  const { posts = [] } = await call("GET", `/api/circles/${enc(circle.id)}/posts`, undefined);
  const have = new Set(posts.map((p) => norm(p.title)));

  console.log(`\n  ${label}  →  topic "${topic?.label ?? "(default)"}"  ·  ${posts.length} existing post(s)`);

  for (const item of items) {
    if (have.has(norm(item.title))) {
      console.log(`    = ${item.id}  ${item.title.slice(0, 58)}`);
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`    + ${item.id}  ${item.title.slice(0, 58)}   [tags: ${(item.tags ?? []).join(", ")}]`);
      created++;
      continue;
    }
    try {
      const post = await call("POST", `/api/circles/${enc(circle.id)}/posts`, {
        topicId: topic?.id ?? null,
        title: item.title,
        body: item.body ?? "",
        tags: item.tags ?? [],
      });
      const postId = post?.id ?? post?.post?.id;
      if (!postId) throw new Error(`no post id in response: ${JSON.stringify(post).slice(0, 120)}`);

      const ans = await call("POST", `/api/posts/${enc(postId)}/answers`, { body: item.answer });
      const answerId = ans?.id ?? ans?.answer?.id;

      // Accepting marks it as THE answer — that green tick is why the page is
      // worth landing on from a Telegram link.
      if (answerId) {
        await call("POST", `/api/answers/${enc(answerId)}/accept`).catch(() => {});
      }
      console.log(`    + ${item.id}  ${item.title.slice(0, 58)}   → /c/${circle.id}/p/${postId}`);
      created++;
    } catch (e) {
      console.error(`    ! ${item.id} failed: ${e.message}`);
      failed++;
    }
  }
}

console.log(`\n${DRY_RUN ? "would create" : "created"} ${created}, ${skipped} already there, ${failed} failed.`);
if (!DRY_RUN && created > 0) {
  console.log(`Next: node scripts/export-telegram-posts.mjs   # turn these into messages you can paste into the groups`);
}
if (failed > 0) process.exitCode = 1;
