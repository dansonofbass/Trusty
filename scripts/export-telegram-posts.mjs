#!/usr/bin/env node
/**
 * Turn seeded forum threads into ready-to-post Telegram messages.
 *
 * The point of seeding answers is that they get SHARED back into the groups
 * people already live in. A Telegram link preview is the whole funnel: the
 * card shows the Persian question, tapping it opens the answer with no login.
 * So each message here is one question, a short pull from its answer, and the
 * public link — never a wall of links, never a pitch.
 *
 * Writes a plan to stdout (and to --out) by default. It does NOT send: posting
 * into groups you do not run is spam, and it is the one thing you cannot undo.
 * `--send` exists for a chat you own, and requires the chat id explicitly.
 *
 *   node scripts/export-telegram-posts.mjs                        # print the plan
 *   node scripts/export-telegram-posts.mjs --out telegram.txt
 *   node scripts/export-telegram-posts.mjs --circle اقامت --per-day 3
 *   TELEGRAM_BOT_TOKEN=… node scripts/export-telegram-posts.mjs --send --chat -1001234567890
 */
const GRAPH = process.env.GRAPH_URL ?? "http://localhost:4001";
const APP = process.env.APP ?? "irham";
const BASE = (process.env.APP_PUBLIC_URL ?? "https://mytrusty.app").replace(/\/+$/, "");
const SEED_USER = process.env.SEED_USER ?? "irham-seed";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const ONLY_CIRCLE = flag("circle");
const PER_DAY = Number(flag("per-day", 3)) || 3;
const OUT = flag("out");
const SEND = has("send");
const CHAT = flag("chat");
const LIMIT = Number(flag("limit", 0)) || 0;

const HEADERS = {
  "content-type": "application/json",
  "x-user-id": SEED_USER,
  "x-user-admin": "1",
  "x-app": APP,
};

async function call(path) {
  const r = await fetch(`${GRAPH}${path}`, { headers: HEADERS });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/** First one or two sentences — enough to prove the answer is concrete. */
function teaser(body, max = 220) {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("،"), cut.lastIndexOf("—"), cut.lastIndexOf(" "));
  return `${cut.slice(0, stop > 80 ? stop : max).trim()}…`;
}

const { circles } = await call("/api/circles");
const wanted = ONLY_CIRCLE
  ? circles.filter((c) => c.label.toLowerCase() === String(ONLY_CIRCLE).toLowerCase())
  : circles;
if (!wanted.length) {
  console.error(`no circle matched ${ONLY_CIRCLE ?? "(all)"} — check the label`);
  process.exit(1);
}

const messages = [];
for (const c of wanted) {
  const { posts = [] } = await call(`/api/circles/${encodeURIComponent(c.id)}/posts?sort=new&limit=100`);
  for (const p of posts) {
    if (!p.answerCount && !p.acceptedAnswerId) continue; // never share an unanswered thread
    const thread = await call(`/api/posts/${encodeURIComponent(p.id)}`).catch(() => null);
    const answers = thread?.answers ?? [];
    const best = answers.find((a) => a.accepted) ?? answers[0];
    if (!best) continue;
    messages.push({
      circle: c.label,
      title: p.title,
      url: `${BASE}/c/${c.id}/p/${p.id}`,
      text: `❓ ${p.title}\n\n${teaser(best.body)}\n\n👇 پاسخ کامل، بدون نیاز به ثبت‌نام:\n${BASE}/c/${c.id}/p/${p.id}`,
    });
  }
}

if (!messages.length) {
  console.error("nothing to export — run seed-forum-qa.mjs first, or check that posts have answers");
  process.exit(1);
}

const list = LIMIT ? messages.slice(0, LIMIT) : messages;

// A drip plan, because 25 links in one evening reads as spam and gets you
// removed from exactly the groups you need.
const lines = [];
lines.push(`# ${list.length} message(s) · ${PER_DAY}/day → ${Math.ceil(list.length / PER_DAY)} day(s)`);
lines.push(`# Post one at a time, in the thread where the question actually comes up.`);
lines.push("");
list.forEach((m, i) => {
  const day = Math.floor(i / PER_DAY) + 1;
  lines.push(`${"─".repeat(66)}`);
  lines.push(`# day ${day}  ·  ${m.circle}`);
  lines.push(`${"─".repeat(66)}`);
  lines.push(m.text);
  lines.push("");
});

const out = lines.join("\n");
if (OUT && typeof OUT === "string") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, out, "utf8");
  console.log(`wrote ${list.length} message(s) → ${OUT}`);
} else {
  console.log(out);
}

if (!SEND) {
  console.log(`\n${list.length} ready. Nothing was sent.`);
  console.log(`Paste them by hand, or: --send --chat <id> with TELEGRAM_BOT_TOKEN set (a chat you run).`);
  process.exit(0);
}

// ---- sending (opt-in, one chat, explicit) ----
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN is not set — refusing to send."); process.exit(1); }
if (!CHAT || CHAT === true) { console.error("--send needs --chat <id>. Refusing to guess a destination."); process.exit(1); }

console.log(`\nsending ${list.length} message(s) to ${CHAT} …`);
let sent = 0;
for (const m of list) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: m.text, disable_web_page_preview: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { console.error(`  ! ${m.title.slice(0, 40)}: ${j.description ?? r.status}`); continue; }
  sent++;
  console.log(`  ✓ ${m.title.slice(0, 56)}`);
  await new Promise((res) => setTimeout(res, 3000)); // Telegram rate limit + human pacing
}
console.log(`\nsent ${sent}/${list.length}.`);
