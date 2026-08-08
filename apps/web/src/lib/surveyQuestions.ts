/**
 * The market-test survey's 5 questions — shared between the public /survey
 * page and the in-onboarding fallback (for registrants who skipped /survey),
 * so both stay in sync and feed the same survey_responses store. `value`
 * fields are the wire format graph-service validates against
 * (services/graph-service/src/survey.ts's ANSWER_OPTIONS) — never translate
 * those, only the Persian `label`/`title` text shown to the visitor.
 *
 * Copy is Persian on purpose (the audience is Iranians relocating — a
 * Farsi-first survey gets answered; an English one gets skipped) and written
 * the way the diaspora actually talks about this stuff: Telegram groups for
 * advice, Instagram "مشاور مهاجرت" ads nobody quite trusts, money transfer out
 * of Iran as its own distinct headache — not generic "banking."
 */

export type QKey = "stage" | "biggestNeed" | "workaround" | "wtpSession" | "wtpSubscription";

export interface SurveyQuestion {
  key: QKey;
  title: string;
  options: { value: string; label: string }[];
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    key: "stage",
    title: "الان کجای مسیر مهاجرتی؟",
    options: [
      { value: "exploring", label: "تازه دارم بهش فکر می‌کنم" },
      { value: "planning", label: "دارم فعالانه اقدام می‌کنم (ویزا، اقامت و این‌جور کارا)" },
      { value: "recently_arrived", label: "تازه رسیدم (کمتر از ۶ ماه پیش)" },
      { value: "settled", label: "یه مدتیه ساکن شدم، ولی هنوز چالش دارم" },
    ],
  },
  {
    key: "biggestNeed",
    title: "الان بزرگ‌ترین دغدغه‌ت چیه؟",
    options: [
      { value: "legal", label: "ویزا، اقامت و کارای حقوقی/اداری" },
      { value: "housing", label: "پیدا کردن خونه و اجاره" },
      { value: "banking", label: "پول و بانک، به‌خصوص انتقال پول از ایران" },
      { value: "career", label: "پیدا کردن کار و آشنا شدن با آدمای جدید" },
    ],
  },
  {
    key: "workaround",
    title: "الان چطوری دنبال یه کمک قابل‌اعتماد می‌گردی؟",
    options: [
      { value: "ask_network", label: "از دوست و آشنا یا گروه‌های تلگرامی می‌پرسم" },
      { value: "search_myself", label: "خودم تو گوگل و اینستاگرام سرچ می‌کنم" },
      { value: "hired_online", label: "از یه مشاور که تو اینستاگرام/تلگرام دیدم کمک گرفتم و به شانس امیدوارم" },
      { value: "no_reliable_help", label: "هنوز کسی رو پیدا نکردم که واقعاً بشه بهش اعتماد کرد" },
    ],
  },
  {
    key: "wtpSession",
    title:
      "اگه بشه یه تماس ۱۵ دقیقه‌ای با یه متخصص (وکیل، مشاور املاک، حسابدار...) بگیری که بقیه ایرانی‌ها هم تاییدش کردن، چقدر حاضری بابتش بدی؟",
    options: [
      { value: "free_only", label: "فقط اگه رایگان باشه" },
      { value: "5_15", label: "۵ تا ۱۵ دلار" },
      { value: "15_30", label: "۱۵ تا ۳۰ دلار" },
      { value: "30_plus", label: "بیشتر از ۳۰ دلار" },
    ],
  },
  {
    key: "wtpSubscription",
    title: "چقدر حاضری در ماه بابت اپی بدی که کمکت می‌کنه آدم و جواب قابل‌اعتماد پیدا کنی؟",
    options: [
      { value: "free_only", label: "هیچی، فقط از امکانات رایگان استفاده می‌کنم" },
      { value: "3_7", label: "۳ تا ۷ دلار در ماه" },
      { value: "7_15", label: "۷ تا ۱۵ دلار در ماه" },
      { value: "15_plus", label: "بیشتر از ۱۵ دلار در ماه" },
    ],
  },
];

export const NEED_LABEL: Record<string, string> = {
  legal: "ویزا و کارای حقوقی",
  housing: "مسکن و اجاره",
  banking: "پول، بانک و انتقال ارز",
  career: "کار و آشنایی با آدمای جدید",
};

/** Submit answers to the shared (anonymous) survey store — safe to call both
 *  from the public pre-signup page and from inside authenticated onboarding,
 *  since the market test counts every respondent, not just one entry point. */
export async function submitSurvey(
  answers: Record<QKey, string>,
): Promise<{ ok: boolean; id?: string; topic?: string; error?: string }> {
  const r = await fetch("/api/public/survey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answers),
  });
  const data = (await r.json().catch(() => null)) as { ok?: boolean; id?: string; topic?: string; error?: string } | null;
  return { ok: !!data?.ok, id: data?.id, topic: data?.topic, error: data?.error };
}
