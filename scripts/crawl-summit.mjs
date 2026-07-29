#!/usr/bin/env node
/**
 * Crawl the Seaside Startup Summit agenda (Next.js RSC flight payload) into
 * admin-import rows:
 *   infra/fixtures/summit-data.json  →  { rows: [{entityType,label,properties}] }
 *
 * Mentors come from per-session speaker objects (deduped by id); sessions
 * from the sessions array (day/time/stream mapped from tracks). Run locally:
 *   node scripts/crawl-summit.mjs
 * then feed the file through seed-summit.mjs (which imports it if present).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const URL_ = process.env.AGENDA_URL ?? "https://agenda.seasidestartupsummit.com/agenda";
const here = dirname(fileURLToPath(import.meta.url));

const html = await (await fetch(URL_)).text();

// Reassemble the flight payload: every self.__next_f.push([1,"…"]) chunk,
// unescaped from its JS string literal.
const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => m[1]);
const flight = chunks
  .join("")
  .replace(/\\"/g, '"')
  .replace(/\\n/g, "\n")
  .replace(/\\\\/g, "\\")
  .replace(/\\u0026/g, "&");

const clean = (v) => (typeof v === "string" && !v.startsWith("$") ? v.trim() : "");

/** Expertise tags inferred from a mentor's title/affiliation — these are what
 *  the match engine scores against attendees' skills_needed. */
const EXPERTISE_RULES = [
  [/invest|venture|capital|vc\b|fund|angel/i, "fundraising"],
  [/market|growth|brand|commun/i, "marketing"],
  [/product|cpo|pm\b/i, "product"],
  [/tech|cto|engineer|developer|ai\b|ml\b|data/i, "tech"],
  [/law|legal|attorney|ip\b|patent/i, "legal"],
  [/sales|revenue|business development|bd\b/i, "sales"],
  [/design|ux|ui\b|creative/i, "design"],
  [/hr\b|people|talent|recruit/i, "hr"],
  [/strateg|ceo|founder|entrepreneur|innovation|accelerat|incubat/i, "strategy"],
  [/financ|cfo|account|tax/i, "finance"],
];
const inferExpertise = (text) => {
  const tags = new Set();
  for (const [re, tag] of EXPERTISE_RULES) if (re.test(text)) tags.add(tag);
  return [...tags].slice(0, 4);
};

// ---- tracks (stream names) ----
const tracks = new Map();
for (const m of flight.matchAll(/\{"id":"(\w+)","eventId":"\w+","name":"([^"]{2,60})","kind":"\w+","color/g)) {
  tracks.set(m[1], m[2]);
}

// ---- speakers → mentors (deduped) ----
const mentors = new Map();
for (const m of flight.matchAll(
  /"speaker":\{"id":"(\w+)","name":"([^"]{2,80})","title":(null|"(?:[^"\\]|\\.)*"),"company":(null|"(?:[^"\\]|\\.)*"),"bio":(null|"[^"]*"),"photoUrl":(null|"[^"]*")/g,
)) {
  const [, id, name, titleRaw, companyRaw, , photoRaw] = m;
  if (mentors.has(id)) continue;
  const title = titleRaw === "null" ? "" : clean(JSON.parse(titleRaw));
  const company = companyRaw === "null" ? "" : clean(JSON.parse(companyRaw));
  const photo = photoRaw === "null" ? "" : clean(JSON.parse(photoRaw));
  const expertise = inferExpertise(`${title} ${company}`);
  mentors.set(id, {
    entityType: "mentor",
    label: name.trim(),
    properties: {
      ...(title ? { title } : {}),
      ...(company || title.includes("|") ? { organization: company || title.split("|")[0].trim() } : {}),
      ...(photo ? { photo } : {}),
      ...(expertise.length ? { expertise, skills_offered: expertise } : {}),
    },
  });
}

// ---- sessions ----
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Asia/Yerevan" });
const TIME = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Yerevan" });
const sessions = [];
const seenSessions = new Set();
for (const m of flight.matchAll(
  /\{"id":"(\w+)","eventId":"\w+","trackId":(null|"\w+"),"title":"((?:[^"\\]|\\.)*)","description":(null|"(?:[^"\\]|\\.)*"|"\$\w+"),"startsAt":"([^"]+)","endsAt":"([^"]+)","type":"(\w+)"/g,
)) {
  const [, id, trackRaw, title, , startsAt, endsAt, type] = m;
  if (seenSessions.has(id) || type === "BREAK") continue;
  seenSessions.add(id);
  const start = new Date(startsAt);
  const stream = trackRaw === "null" ? "" : tracks.get(JSON.parse(trackRaw)) ?? "";
  sessions.push({
    entityType: "session",
    label: title.replace(/\\"/g, '"').trim().slice(0, 120),
    properties: {
      day: DAY.format(start),
      time: `${TIME.format(start)}–${TIME.format(new Date(endsAt))}`,
      ...(stream ? { stream } : {}),
    },
  });
}

const rows = [...mentors.values(), ...sessions];
const out = join(here, "..", "infra", "fixtures", "summit-data.json");
writeFileSync(out, JSON.stringify({ rows }, null, 2));
console.log(`crawled ${mentors.size} mentors + ${sessions.length} sessions (tracks: ${[...new Set(tracks.values())].join(", ")}) → ${out}`);
