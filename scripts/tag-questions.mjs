#!/usr/bin/env node
/**
 * Give existing questions real tags, and load each circle's tag vocabulary.
 *
 * Two jobs, both idempotent:
 *   1. Push the curated per-circle tag list onto the circle, so the "ask a
 *      question" composer offers a consistent vocabulary instead of letting
 *      everyone free-type visa / Visa / visas.
 *   2. Back-fill tags onto questions that already exist, by matching keywords
 *      against each question's title + body, and normalising the legacy
 *      English tags the first migration carried over (residency → اقامت).
 *
 * Matching is deliberately dumb (substring, case-insensitive) rather than
 * clever: it is reviewable, and a moderator can fix any question's tags from
 * the forum. Existing tags are never dropped — only added to.
 *
 *   docker compose exec -T graph-service node /workspace/scripts/tag-questions.mjs
 *   DRY_RUN=1 node scripts/tag-questions.mjs     # print, change nothing
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const APP = process.env.APP ?? "irham";
const DRY_RUN = process.env.DRY_RUN === "1";
const HEADERS = {
  "content-type": "application/json",
  "x-user-id": process.env.SEED_USER ?? "irham-seed",
  "x-user-admin": "1",
  "x-app": APP,
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "..", "infra", "fixtures", "irham-question-tags.json"), "utf8"));
const LEGACY = fixture._legacy ?? {};

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
if (!circles?.length) {
  console.error("no circles found — run seed-circles.mjs first");
  process.exit(1);
}

let taggedTotal = 0;
let vocabTotal = 0;

for (const circle of circles) {
  const rules = fixture.circles[circle.label];
  if (!rules) continue;

  // 1. the circle's offered vocabulary
  const vocab = rules.map((r) => r.tag);
  if (!DRY_RUN) {
    await call("PATCH", `/api/admin/circles/${encodeURIComponent(circle.id)}/suggested-tags`, { tags: vocab });
  }
  vocabTotal += vocab.length;

  // 2. back-fill the questions already in there
  const { posts } = await call("GET", `/api/circles/${encodeURIComponent(circle.id)}/posts?limit=100`);
  let tagged = 0;

  for (const post of posts ?? []) {
    const haystack = `${post.title ?? ""}\n${post.body ?? ""}`.toLowerCase();
    const existing = (post.tags ?? []).map((t) => LEGACY[t] ?? t); // normalise legacy English
    const matched = rules.filter((r) => r.match.some((m) => haystack.includes(String(m).toLowerCase()))).map((r) => r.tag);

    const next = [...new Set([...existing, ...matched])].slice(0, 6);
    const unchanged =
      next.length === (post.tags ?? []).length && next.every((t) => (post.tags ?? []).includes(t));
    if (unchanged) continue;

    if (DRY_RUN) {
      console.log(`  [dry] ${post.title.slice(0, 60)}…\n        ${(post.tags ?? []).join(", ") || "(none)"} → ${next.join(", ")}`);
    } else {
      await call("PATCH", `/api/posts/${encodeURIComponent(post.id)}/tags`, { tags: next });
    }
    tagged++;
  }

  taggedTotal += tagged;
  console.log(`  ${circle.label}: ${vocab.length} tags offered, ${tagged}/${(posts ?? []).length} questions re-tagged`);
}

console.log(
  `\n${DRY_RUN ? "[dry run] " : ""}done — ${vocabTotal} tags across the vocabulary, ${taggedTotal} questions updated.`,
);
if (DRY_RUN) console.log("Re-run without DRY_RUN=1 to apply.");
