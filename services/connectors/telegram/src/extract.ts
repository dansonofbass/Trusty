/**
 * Knowledge extraction — turns classified messages into reviewable candidates.
 *
 * Three extractors, all deterministic:
 *
 *  qa       question + its best reply → a forum-ready thread
 *  outcome  "I applied / got rejected / it took N days / cost X" → a structured event
 *  provider bank, office or agency + a verdict, aggregated across authors
 *
 * The design rule that matters: an outcome is never SOLICITED. In the corpus,
 * every single outcome report was written as the preamble to the author's next
 * question — nobody came back after finishing to donate knowledge. So we mine
 * outcomes out of ordinary messages instead of asking anyone for them.
 */
import { createHash } from "node:crypto";
import type { Classified, OutcomeCandidate, ProviderCandidate, QaCandidate } from "./types";

const keyOf = (...parts: (string | number)[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20);

/* ------------------------------ hard specifics ---------------------------- */

/** A fee, a deadline, an office name or a form number. Vague answers are worse than none. */
const OFFICES = [
  "اداره مهاجرت","تایروف","tairov","permit.am","migration.e-gov.am","earlyone","کلانتری",
  "تأمین اجتماعی","تامین اجتماعی","اداره ثبت","state registry","src","نوتاری","notary","ovir",
];
const MONEY = /(\d[\d,.،٬\s]{2,12})\s*(درام|dram|amd|dollar|دلار|تومان|هزار|k\b)/i;
const DEADLINE =
  /(\d{1,2}\s*(ژانویه|فوریه|مارس|آوریل|مه|ژوئن|ژوئیه|اوت|آگوست|سپتامبر|اکتبر|نوامبر|دسامبر|january|february|march|april|may|june|july|august|september|october|november|december))|(\d+\s*(روز|ماه|سال|هفته|day|month|week|year))/i;

export function hasHardSpecific(text: string): boolean {
  const t = text.toLowerCase();
  return MONEY.test(text) || DEADLINE.test(text) || OFFICES.some((o) => t.includes(o));
}

/* --------------------------------- Q&A ----------------------------------- */

/** Answer quality: length, specificity, and not being a "thanks". */
const THANKS = /^(ممنون|مرسی|سپاس|تشکر|thanks|thank you|ok|okay|👍|🙏)/i;

function answerScore(text: string): number {
  if (THANKS.test(text.trim())) return 0;
  let s = 0;
  if (text.length >= 200) s += 3;
  else if (text.length >= 90) s += 2;
  else if (text.length >= 40) s += 1;
  if (hasHardSpecific(text)) s += 3;
  if (/\n/.test(text)) s += 1; // structured, multi-line
  return s;
}

export interface QaOptions {
  circle: string;
  /** Only emit when the answer clears this bar. Default 4 = has substance AND a specific. */
  minAnswerScore?: number;
}

/**
 * Pair each question with the best reply it received. Only direct replies count:
 * in a group posting 300 messages a day, "the next message" is coincidence, not
 * an answer — measuring it that way inflated our answer rate from 43% to 98%.
 */
export function extractQa(messages: Classified[], opts: QaOptions): QaCandidate[] {
  const minScore = opts.minAnswerScore ?? 4;
  const byId = new Map<number, Classified>();
  const replies = new Map<number, Classified[]>();
  for (const m of messages) byId.set(m.id, m);
  for (const m of messages) {
    if (m.replyTo == null) continue;
    const arr = replies.get(m.replyTo);
    if (arr) arr.push(m);
    else replies.set(m.replyTo, [m]);
  }

  const out: QaCandidate[] = [];
  for (const q of messages) {
    if (q.cls !== "question") continue;
    if (q.text.length < 25) continue; // fragments like "چقدره؟" carry no thread context

    const candidates = (replies.get(q.id) ?? []).filter(
      (r) => r.authorKey !== q.authorKey && r.cls !== "ad" && r.cls !== "listing",
    );
    if (candidates.length === 0) continue;

    const best = candidates
      .map((r) => ({ r, score: answerScore(r.text) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best.score < minScore) continue;

    const title = q.text.split("\n")[0].trim().slice(0, 180);
    out.push({
      key: keyOf("qa", q.sourceId, q.id),
      sourceId: q.sourceId,
      kind: "qa",
      evidence: [q.id, best.r.id],
      confidence: Math.min(0.95, 0.45 + best.score * 0.08),
      stage: "heuristic",
      createdAt: new Date().toISOString(),
      circle: opts.circle,
      title,
      body: q.text.length > title.length ? q.text.slice(0, 1200) : "",
      answer: best.r.text.slice(0, 4000),
      tags: q.topics,
      hasHardSpecific: hasHardSpecific(best.r.text),
    });
  }
  return out;
}

/* ------------------------------- outcomes -------------------------------- */

const STEP_PATTERNS: [step: string, re: RegExp][] = [
  ["bank_account", /(حساب بانکی|افتتاح حساب|حساب باز|business account|bank account|open an account)/i],
  ["residency_card", /(کارت اقامت|اقامت.*(گرفتم|اقدام|دادم)|residency card|residence permit)/i],
  ["migration_appointment", /(نوبت|قرار.*مهاجرت|appointment|ovir|تایروف|tairov)/i],
  ["ie_registration", /(ثبت شرکت|ثبت ای ای|\bIE\b|state registry|entrepreneur)/i],
  ["address_registration", /(ثبت آدرس|رجیستر آدرس|address registration|کلانتری)/i],
  ["tax_regime", /(رژیم مالیاتی|میکرو بیزینس|turnover tax|مالیات.*ثبت)/i],
  ["passport_translation", /(ترجمه پاسپورت|ترجمهٔ پاسپورت|passport translation|نوتاری)/i],
  ["social_number", /(سوشیال|سوشال|social (card|number)|سوتیک)/i],
];

const RESULT_PATTERNS: [result: OutcomeCandidate["result"], re: RegExp, reason?: string][] = [
  ["rejected", /(رد کرد|رد شد|ریجکت|قبول نکرد|جواب رد|refus|rejected|denied|declined)/i, "refused"],
  ["approved", /(تأیید شد|تایید شد|قبول شد|باز کرد|گرفتم|صادر شد|approved|accepted|opened|got (my|the))/i],
  ["pending", /(هنوز|منتظر|در حال بررسی|still waiting|pending|no answer yet)/i],
  ["abandoned", /(بیخیال شدم|ول کردم|منصرف|gave up|abandoned)/i],
];

const REASON_CODES: [code: string, re: RegExp][] = [
  ["documents", /(مدارک|مدرک|document|paperwork)/i],
  ["income_proof", /(درآمد|گردش|income|turnover|source of fund|proof of fund)/i],
  ["nationality", /(ایرانی|پاسپورت ایران|iranian|nationality|passport)/i],
  ["no_reason", /(بدون دلیل|دلیلی نگفت|no reason)/i],
  ["risk", /(ریسک|too risky|خطرناک)/i],
];

const parseAmd = (text: string): number | undefined => {
  const m = text.match(MONEY);
  if (!m) return undefined;
  const digits = m[1].replace(/[,.،٬\s]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return /هزار|\bk\b/i.test(m[2]) ? n * 1000 : n;
};

const parseDays = (text: string): number | undefined => {
  const m = text.match(/(\d+|[۰-۹]+)\s*(روز|day|هفته|week|ماه|month)/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
  if (!Number.isFinite(n)) return undefined;
  if (/هفته|week/i.test(m[2])) return n * 7;
  if (/ماه|month/i.test(m[2])) return n * 30;
  return n;
};

/**
 * Mine outcome events from first-person reports. Requires a first-person marker
 * so we record what someone DID, not what they heard — "رفتم و رد کردن" counts,
 * "میگن رد میکنن" does not.
 */
const FIRST_PERSON = /(رفتم|دادم|گرفتم|اقدام کردم|امتحان کردم|بهم|برام|من\b|ما\b|i went|i applied|i tried|they told me|for me)/i;

export function extractOutcomes(messages: Classified[]): OutcomeCandidate[] {
  const out: OutcomeCandidate[] = [];
  for (const m of messages) {
    if (m.cls === "ad" || m.cls === "listing" || m.cls === "media") continue;
    if (m.text.length < 30) continue;
    if (!FIRST_PERSON.test(m.text)) continue;

    const step = STEP_PATTERNS.find(([, re]) => re.test(m.text))?.[0];
    if (!step) continue;
    const hit = RESULT_PATTERNS.find(([, re]) => re.test(m.text));
    if (!hit) continue;

    const [result, , defaultReason] = hit;
    const reasonCode =
      result === "rejected"
        ? (REASON_CODES.find(([, re]) => re.test(m.text))?.[0] ?? defaultReason)
        : undefined;

    out.push({
      key: keyOf("outcome", m.sourceId, m.id),
      sourceId: m.sourceId,
      kind: "outcome",
      evidence: [m.id],
      // First-person + an explicit result is a strong signal; still below the
      // auto-publish bar, because "رد شد" can be about someone else's case.
      confidence: 0.65,
      stage: "heuristic",
      createdAt: new Date().toISOString(),
      step,
      provider: detectProvider(m.text),
      result,
      reasonCode,
      costAmd: parseAmd(m.text),
      durationDays: parseDays(m.text),
      occurredAt: m.date,
    });
  }
  return out;
}

/* ------------------------------- providers -------------------------------- */

const PROVIDERS: [name: string, category: string, re: RegExp][] = [
  ["VTB", "bank", /\bvtb\b/i],
  ["Ameriabank", "bank", /\bameria/i],
  ["Ardshinbank", "bank", /\bardshin/i],
  ["Inecobank", "bank", /\bineco/i],
  ["Converse Bank", "bank", /\bconverse/i],
  ["Fast Bank", "bank", /\bfast\s?bank/i],
  ["Amio Bank", "bank", /\bamio/i],
  ["IDBank", "bank", /\bid\s?bank|idbank/i],
  ["Evocabank", "bank", /\bevoca/i],
  ["Unibank", "bank", /\bunibank/i],
  ["ACBA", "bank", /\bacba\b/i],
  ["Araratbank", "bank", /\bararat\s?bank/i],
  ["Mellat", "bank", /\bmellat|ملت/i],
  ["MCS Tairov 14", "office", /تایروف|tairov|اداره مهاجرت/i],
];

export const detectProvider = (text: string): string | undefined =>
  PROVIDERS.find(([, , re]) => re.test(text))?.[0];

const POS = /(باز کرد|قبول کرد|تأیید|تایید|راحت|بدون مشکل|opened|approved|accepted|no problem|easy|worked)/i;
const NEG = /(رد کرد|قبول نمی|باز نمی|refus|reject|denied|not open|no foreigner|not allowed|impossible)/i;

/**
 * Aggregate provider verdicts across DISTINCT authors. One person's bad day is
 * an anecdote; four people in a month is a policy change — and the count of
 * distinct reporters is the only number a reader should trust.
 *
 * Sentences naming several providers at once are skipped: "I tried fastbank,
 * converse, amio — none opened" reads as positive for all three to any
 * token-level scorer, which is exactly the bug this guard exists to prevent.
 */
export function extractProviders(messages: Classified[]): ProviderCandidate[] {
  const tally = new Map<string, { pos: Set<string>; neg: Set<string>; ev: number[]; cat: string }>();

  for (const m of messages) {
    if (m.cls === "ad" || m.cls === "listing") continue;
    for (const raw of m.text.split(/[\n•]|(?<=[.!?؟])\s+/)) {
      const seg = raw.trim();
      if (seg.length < 8) continue;
      const named = PROVIDERS.filter(([, , re]) => re.test(seg));
      if (named.length !== 1) continue; // ambiguous multi-provider sentence
      const [name, cat] = named[0];
      const pos = POS.test(seg);
      const neg = NEG.test(seg);
      if (pos === neg) continue; // neither, or contradictory in one breath
      const row = tally.get(name) ?? { pos: new Set(), neg: new Set(), ev: [], cat };
      (pos ? row.pos : row.neg).add(m.authorKey);
      if (row.ev.length < 20) row.ev.push(m.id);
      tally.set(name, row);
    }
  }

  const out: ProviderCandidate[] = [];
  for (const [name, row] of tally) {
    const reporters = new Set([...row.pos, ...row.neg]).size;
    if (reporters < 2) continue; // one voice is an anecdote
    const verdict: ProviderCandidate["verdict"] =
      row.pos.size > row.neg.size * 2 ? "works"
      : row.neg.size > row.pos.size * 2 ? "blocked"
      : "contested";
    out.push({
      key: keyOf("provider", messages[0]?.sourceId ?? "", name),
      sourceId: messages[0]?.sourceId ?? "",
      kind: "provider",
      evidence: row.ev,
      confidence: Math.min(0.9, 0.4 + reporters * 0.1),
      stage: "heuristic",
      createdAt: new Date().toISOString(),
      provider: name,
      category: row.cat,
      verdict,
      reporters,
    });
  }
  return out.sort((a, b) => b.reporters - a.reporters);
}
