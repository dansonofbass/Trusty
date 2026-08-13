/**
 * Telegram Desktop JSON export → TgMessage[].
 *
 * This is the backfill path: it is the only way to get a group's HISTORY, because
 * a bot added today can never see yesterday. Exports are also the honest path —
 * they are produced by a member of the group using the official client, rather
 * than by scraping with a user account.
 */
import { createHash } from "node:crypto";
import type { TgMessage, TgSource } from "../types";

/** Telegram writes text as a string, or an array of strings and entity objects. */
type RawText = string | (string | { type?: string; text?: string })[];
interface RawMsg {
  id?: number;
  type?: string;
  date?: string;
  from?: string;
  from_id?: string;
  text?: RawText;
  reply_to_message_id?: number;
  photo?: unknown;
  file?: unknown;
  media_type?: string;
  poll?: unknown;
}

export interface ParsedExport {
  title: string;
  chatId?: string;
  messages: TgMessage[];
  warnings: string[];
}

/**
 * Telegram Desktop on a Persian/Arabic locale writes decimals with `/` instead
 * of `.` inside location_information, which makes the file invalid JSON. Seen in
 * the wild on every export from that locale — repair it rather than making a
 * human hand-edit a 15 MB file.
 */
export function repairExportJson(raw: string): { text: string; repairs: number } {
  let repairs = 0;
  const text = raw.replace(
    /"(latitude|longitude)":\s*(-?\d+)\/(\d+)/g,
    (_m, key: string, whole: string, frac: string) => {
      repairs++;
      return `"${key}": ${whole}.${frac}`;
    },
  );
  return { text, repairs };
}

export const flattenText = (t: RawText | undefined): string => {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.map((x) => (typeof x === "string" ? x : (x.text ?? ""))).join("");
  return "";
};

const countEntities = (t: RawText | undefined) => {
  const ent = { phone: 0, mention: 0, link: 0, bold: 0, email: 0 };
  if (!Array.isArray(t)) return ent;
  for (const part of t) {
    if (typeof part === "string") continue;
    const k = part.type;
    if (k === "phone") ent.phone++;
    else if (k === "mention" || k === "mention_name") ent.mention++;
    else if (k === "link" || k === "text_link") ent.link++;
    else if (k === "bold") ent.bold++;
    else if (k === "email") ent.email++;
  }
  return ent;
};

/** Pseudonymous and stable: enough to count distinct reporters, useless for identifying anyone. */
export const authorKeyFor = (sourceId: string, fromId: string | undefined, from: string): string =>
  createHash("sha256").update(`${sourceId}|${fromId ?? from ?? "?"}`).digest("hex").slice(0, 16);

export function parseExport(raw: string, source: Pick<TgSource, "id">): ParsedExport {
  const warnings: string[] = [];
  const { text, repairs } = repairExportJson(raw);
  if (repairs > 0) {
    warnings.push(
      `repaired ${repairs} malformed coordinate value(s) — Telegram Desktop writes "40/205711" for "40.205711" on Persian/Arabic locales`,
    );
  }

  let doc: { name?: string; id?: number | string; messages?: RawMsg[] };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch (e) {
    throw new Error(
      `export is not valid JSON even after repair: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const rows = Array.isArray(doc.messages) ? doc.messages : [];
  if (rows.length === 0) warnings.push("export contains no messages — wrong file?");

  const messages: TgMessage[] = [];
  for (const m of rows) {
    if (m.type !== "message") continue; // service rows (joins, pins) carry no knowledge
    if (typeof m.id !== "number" || !m.date) continue;
    const body = flattenText(m.text);
    const from = m.from ?? "unknown";
    messages.push({
      sourceId: source.id,
      id: m.id,
      date: new Date(m.date).toISOString(),
      from,
      authorKey: authorKeyFor(source.id, m.from_id, from),
      text: body,
      replyTo: typeof m.reply_to_message_id === "number" ? m.reply_to_message_id : undefined,
      ent: countEntities(m.text),
      hasMedia: Boolean(m.photo ?? m.file ?? m.poll),
    });
  }

  return {
    title: String(doc.name ?? "untitled group"),
    chatId: doc.id == null ? undefined : String(doc.id),
    messages,
    warnings,
  };
}
