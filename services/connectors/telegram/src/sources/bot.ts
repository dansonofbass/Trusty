/**
 * Bot API live tail → TgMessage[].
 *
 * Keeps a watched group current AFTER an export backfill. Deliberately limited:
 *
 *  - a bot only sees messages sent after it joined, so this can never replace an
 *    export for history;
 *  - it needs privacy mode OFF (BotFather → /setprivacy → Disable) to see normal
 *    group chat, which a group admin must consciously allow;
 *  - we never read a group we were not added to, and we never use a user account
 *    (MTProto scraping breaks Telegram's terms and puts a real person's account
 *    at risk — if you want that history, ask a member for an export).
 */
import { createHash } from "node:crypto";
import type { TgMessage } from "../types";

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

interface Update {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number | string; title?: string };
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    caption?: string;
    reply_to_message?: { message_id: number };
    entities?: { type: string }[];
    photo?: unknown;
    document?: unknown;
  };
}

const authorKey = (sourceId: string, userId: number | undefined, name: string) =>
  createHash("sha256").update(`${sourceId}|${userId ?? name}`).digest("hex").slice(0, 16);

function countEntities(entities: { type: string }[] | undefined) {
  const ent = { phone: 0, mention: 0, link: 0, bold: 0, email: 0 };
  for (const e of entities ?? []) {
    if (e.type === "phone_number") ent.phone++;
    else if (e.type === "mention" || e.type === "text_mention") ent.mention++;
    else if (e.type === "url" || e.type === "text_link") ent.link++;
    else if (e.type === "bold") ent.bold++;
    else if (e.type === "email") ent.email++;
  }
  return ent;
}

export interface PollResult {
  messages: TgMessage[];
  /** Pass back on the next call so Telegram stops re-sending what we've handled. */
  nextOffset: number;
  warnings: string[];
}

/**
 * One long-poll cycle. Returns only messages from chats we are told to watch —
 * `chatIds` is an allow-list, so adding the bot to an unrelated group is inert.
 */
export async function pollUpdates(opts: {
  token: string;
  offset: number;
  chatIds: Map<string, string>; // telegram chat id → our source id
  timeoutSec?: number;
}): Promise<PollResult> {
  const warnings: string[] = [];
  const url = new URL(API(opts.token, "getUpdates"));
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("timeout", String(opts.timeoutSec ?? 25));
  url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

  const r = await fetch(url, { signal: AbortSignal.timeout((opts.timeoutSec ?? 25) * 1000 + 5000) });
  if (!r.ok) throw new Error(`getUpdates → ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = (await r.json()) as { ok: boolean; result?: Update[]; description?: string };
  if (!body.ok) throw new Error(`getUpdates rejected: ${body.description ?? "unknown"}`);

  const updates = body.result ?? [];
  let nextOffset = opts.offset;
  const messages: TgMessage[] = [];

  for (const u of updates) {
    nextOffset = Math.max(nextOffset, u.update_id + 1);
    const m = u.message;
    if (!m) continue;
    const sourceId = opts.chatIds.get(String(m.chat.id));
    if (!sourceId) continue; // not a group we watch
    const text = m.text ?? m.caption ?? "";
    const name =
      [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") ||
      m.from?.username ||
      "unknown";
    messages.push({
      sourceId,
      id: m.message_id,
      date: new Date(m.date * 1000).toISOString(),
      from: name,
      authorKey: authorKey(sourceId, m.from?.id, name),
      text,
      replyTo: m.reply_to_message?.message_id,
      ent: countEntities(m.entities),
      hasMedia: Boolean(m.photo ?? m.document),
    });
  }

  if (updates.length >= 100) {
    warnings.push("100 updates in one poll — the tail is behind; poll more often");
  }
  return { messages, nextOffset, warnings };
}

/** Sanity check at boot so a bad token fails loudly instead of silently polling nothing. */
export async function botIdentity(token: string): Promise<string> {
  const r = await fetch(API(token, "getMe"), { signal: AbortSignal.timeout(10_000) });
  const body = (await r.json()) as { ok: boolean; result?: { username?: string } };
  if (!body.ok) throw new Error("TELEGRAM_BOT_TOKEN rejected by Telegram");
  return body.result?.username ?? "unknown-bot";
}
