#!/usr/bin/env node
/**
 * Promote saved circle answers into forum posts (idempotent).
 *
 * Circles became forums; the seeded Persian knowledge lived as `room_answers`
 * on the old chat rooms. This moves each one into a post in its circle's
 * default topic, keeping the ORIGINAL author and date — attribution is the
 * whole value of community knowledge.
 *
 * It does NOT delete the source rows: the public /a/<id> links are already
 * shared in Telegram groups and must keep resolving. Re-running is a no-op.
 *
 *   docker compose exec -T graph-service node /workspace/scripts/migrate-circle-answers.mjs
 *   # scope to one space / name the destination topic:
 *   APP=irham TOPIC='پرسش‌های عمومی' node scripts/migrate-circle-answers.mjs
 */
const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const APP = process.env.APP ?? "irham";
const TOPIC = process.env.TOPIC ?? "پرسش‌های عمومی";

const qs = new URLSearchParams({ app: APP, topic: TOPIC });
const url = `${GRAPH}/api/admin/forum/migrate-answers?${qs}`;

console.log(`migrating saved answers → forum posts (app="${APP}", topic="${TOPIC}")`);

const r = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-user-id": process.env.SEED_USER ?? "irham-seed",
    "x-user-admin": "1",
    "x-app": APP,
  },
});

const text = await r.text();
if (!r.ok) {
  console.error(`failed (${r.status}): ${text.slice(0, 300)}`);
  process.exit(1);
}

const data = JSON.parse(text);
for (const row of data.results ?? []) {
  console.log(`  ${row.circle}: ${row.migrated} migrated${row.skipped ? `, ${row.skipped} already there` : ""}`);
}
console.log(`\ndone — ${data.migrated} posts created, ${data.skipped} skipped (already migrated or empty).`);
console.log(`Saved answers were left in place; /a/<id> links still resolve.`);
