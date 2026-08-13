/**
 * Message classification — deterministic, auditable, and calibrated against a
 * 15,982-message corpus (three Iranians-in-Armenia groups, May 2025 – Aug 2026).
 *
 * Deliberately NOT an LLM. Three reasons: it runs over a whole export in a
 * second, it costs nothing, and — decisive for a knowledge base about legal
 * process — every decision comes with the reasons that produced it, so an admin
 * can see WHY a message was dropped as an ad. The LLM pass (llm.ts) runs only on
 * the survivors, where judgement actually earns its cost.
 *
 * Corpus behaviour at these thresholds: ads 34% / questions 8% in an unmoderated
 * public group, ads ~0% / questions 23% in a private professional one. Those two
 * numbers moving in opposite directions is the signal the thresholds are sane.
 */
import type { Classified, MsgClass, TgMessage } from "./types";

/* ------------------------------- lexicons ------------------------------- */

const PROMO_GLYPHS = ["✅","✔️","🔹","📍","📞","☎️","📲","🌟","⭐️","💎","🔥","➖","━","▫️","🟢","🟩","💈","✨","🎯","🔻","🔸","💅","🔷"];

const AD_WORDS = [
  "خدمات","مشاوره رایگان","رزرو","تخفیف","همکاری","تماس بگیرید","پیوی","پی وی","دایرکت",
  "اینستاگرام","instagram","واتساپ","whatsapp","ساعت کاری","بهترین","تخصصی","حرفه ای","حرفه‌ای",
  "مجموعه","تیم ما","سفارش","جهت هماهنگی","ظرفیت محدود","ثبت نام","قیمت مناسب","تضمینی",
  "در خدمتم","در خدمتیم","با ما تماس","سابقه درخشان",
];

/** Phrases that make a message a question even without a question mark. */
const Q_STRONG = [
  "کسی میدونه","کسی می‌دونه","کسی اطلاع داره","کسی خبر داره","کسی تجربه","کسی میشناسه",
  "کسی می‌شناسه","کسی رفته","کسی سراغ داره","سراغ دارید","سراغ داره","میخواستم بدونم",
  "می‌خواستم بدونم","سوال داشتم","سوالی داشتم","یه سوال","یک سوال","راهنمایی کنید",
  "راهنمایی میکنید","ممنون میشم راهنمایی","چطور میشه","چجوری میشه","آیا کسی","به نظرتون",
  "نظرتون چیه","پیشنهاد میدید","چیکار کنم","باید چیکار","از کجا میشه","از کجا میتونم",
  "کجا میتونم","اطلاع داره","تجربه داره","معرفی کنید","معرفی میکنید",
  "anyone know","does anyone","has anyone","any idea","is it possible","how do i","how can i",
];

const Q_WORDS = [
  "آیا","چطور","چگونه","چجوری","چقدر","چند","کجا","کدوم","کدام","چرا","چیه","چیست",
  "میشه","می‌شه","هست؟","داره؟","بهتره","معتبره","امکانش","شرایطش","هزینه","لازمه","باید",
  "how","what","where","when","which","why","should","can i","do i need",
];

/** A listing is an ad with inventory — priced, located, repeated. */
const LISTING_WORDS = [
  "اجاره","متری","درام","خواب","طبقه","آسانسور","پارکینگ","مبله","ودیعه","کمیسیون","رهن",
  "لوکیشن","بازدید","واحد","آپارتمان","سوئیت","تخت","هاستل","اتاق",
];

const TOPICS: Record<string, string[]> = {
  residency: ["اقامت","ویزا","رزیدنت","کارت اقامت","تمدید اقامت","سوتیک","پرمیت","residency","visa","permit"],
  border: ["چنج ویزا","چنج","نوردوز","مرز","ورود خروج","ورود و خروج","آگاراک","border"],
  jobs: ["استخدام","کاریابی","نیازمند","فرصت شغلی","دنبال کار","جویای کار","رزومه","حقوق","دستمزد","job","hiring"],
  housing: ["اجاره","آپارتمان","سوئیت","هاستل","پانسیون","دپوزیت","کمیسیون","املاک","همخونه","rent","apartment"],
  banking: ["بانک","حساب بانکی","کارت بانکی","صرافی","انتقال پول","درام","حواله","تتر","کریپتو","bank","account","swift","transfer"],
  tax: ["مالیات","حسابدار","فاکتور","گردش مالی","اظهارنامه","tax","invoice","turnover","accountant"],
  company: ["ثبت شرکت","ای ای","llc","کارآفرین","state registry","entrepreneur","ie registration"],
  transport: ["اتوبوس","بلیط","پرواز","فرودگاه","تاکسی","باربری","چمدان","گواهینامه","flight","bus"],
  health: ["دکتر","پزشک","دندانپزشک","کلینیک","بیمارستان","دارو","بیمه درمانی","doctor","clinic","insurance"],
  education: ["کلاس زبان","آموزشگاه","مدرسه","دانشگاه","آیلتس","تدریس","school","university"],
  legal: ["وکیل","دادگاه","قضایی","شکایت","قرارداد","وکالت","lawyer","court","contract"],
};

/* ------------------------------- scoring -------------------------------- */

const count = (hay: string, needles: string[]) => needles.reduce((n, w) => (hay.includes(w) ? n + 1 : n), 0);

/** Normalised for repeat-detection: digits collapse so "۲ جا مانده" ≡ "۳ جا مانده". */
export const normalizeForRepeat = (t: string): string =>
  t.replace(/[\d۰-۹٠-٩]+/g, "#").replace(/\s+/g, " ").trim().slice(0, 400);

export interface ClassifyOpts {
  /** How many times this exact text was posted by this author across the corpus. */
  repeatCount: number;
}

function promoScore(m: TgMessage, why: string[]): number {
  const t = m.text;
  const lower = t.toLowerCase();
  let s = 0;
  const glyphs = PROMO_GLYPHS.filter((g) => t.includes(g)).length;
  if (glyphs) { s += glyphs * 2; why.push(`${glyphs} promo glyph(s)`); }
  const words = count(lower, AD_WORDS);
  if (words) { s += words; why.push(`${words} sales phrase(s)`); }
  if (m.ent.phone) { s += m.ent.phone * 3; why.push(`${m.ent.phone} phone number(s)`); }
  if (m.ent.mention) { s += m.ent.mention * 2; why.push(`${m.ent.mention} @mention(s)`); }
  if (m.ent.link) { s += m.ent.link; why.push(`${m.ent.link} link(s)`); }
  if (m.ent.bold >= 3) { s += 2; why.push("heavy bold formatting"); }
  if (t.length > 400) { s += 3; why.push("very long (>400 chars)"); }
  else if (t.length > 200) s += 1;
  if (m.hasMedia && t.length > 120) { s += 2; why.push("photo with long caption"); }
  return s;
}

export function isQuestion(text: string): boolean {
  if (text.trim().length < 6) return false;
  const t = text.toLowerCase();
  if (Q_STRONG.some((w) => t.includes(w))) return true;
  const marked = text.includes("؟") || text.includes("?");
  if (marked && Q_WORDS.some((w) => t.includes(w))) return true;
  return marked && text.length < 200;
}

export function topicsOf(text: string): string[] {
  const t = text.toLowerCase();
  const scored = Object.entries(TOPICS)
    .map(([k, ws]) => [k, ws.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 3).map(([k]) => k);
}

/**
 * Classify one message. `confidence` is what the review queue sorts on: anything
 * under 0.6 is shown to a human before it can become knowledge.
 */
export function classify(m: TgMessage, opts: ClassifyOpts): Classified {
  const why: string[] = [];
  const text = m.text.trim();
  const promo = promoScore(m, why);
  const question = isQuestion(text);
  const listingHits = count(text, LISTING_WORDS);

  let cls: MsgClass;
  let confidence: number;

  if (!text) {
    cls = "media"; confidence = 1; why.push("no text");
  } else if (opts.repeatCount >= 3) {
    cls = "ad"; confidence = 0.95;
    why.push(`identical text posted ${opts.repeatCount}× by the same author`);
  } else if (promo >= 12) {
    cls = "ad"; confidence = 0.9;
  } else if (promo >= 7 && !question) {
    cls = "ad"; confidence = 0.7;
  } else if (listingHits >= 4 && text.length > 140) {
    cls = "listing"; confidence = 0.75; why.push(`${listingHits} listing terms`);
  } else if (question && promo < 6) {
    cls = "question"; confidence = promo === 0 ? 0.9 : 0.7;
    why.push("interrogative form");
  } else if (m.replyTo) {
    cls = "answer"; confidence = 0.6; why.push("reply to another message");
  } else if (text.length < 25) {
    cls = "chatter"; confidence = 0.8; why.push("very short");
  } else {
    cls = "statement"; confidence = 0.5;
  }

  return { ...m, cls, confidence, topics: topicsOf(text), why };
}

/** Classify a whole source at once — repeat detection needs the full set. */
export function classifyAll(messages: TgMessage[]): Classified[] {
  const repeats = new Map<string, number>();
  for (const m of messages) {
    if (m.text.length <= 60) continue;
    const k = `${m.authorKey}|${normalizeForRepeat(m.text)}`;
    repeats.set(k, (repeats.get(k) ?? 0) + 1);
  }
  return messages.map((m) =>
    classify(m, {
      repeatCount: m.text.length > 60 ? (repeats.get(`${m.authorKey}|${normalizeForRepeat(m.text)}`) ?? 1) : 1,
    }),
  );
}
