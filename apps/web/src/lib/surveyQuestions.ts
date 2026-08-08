/**
 * The market-test survey's 5 questions — shared between the public /survey
 * page and the in-onboarding fallback (for registrants who skipped /survey),
 * so both stay in sync and feed the same survey_responses store. Mirrors the
 * validation options in services/graph-service/src/survey.ts.
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
    title: "Where are you in your relocation journey?",
    options: [
      { value: "exploring", label: "Just exploring" },
      { value: "planning", label: "Actively planning (visa in progress)" },
      { value: "recently_arrived", label: "Recently arrived (under 6 months)" },
      { value: "settled", label: "Settled, but still need help" },
    ],
  },
  {
    key: "biggestNeed",
    title: "What's the single biggest challenge right now?",
    options: [
      { value: "legal", label: "Legal & visa paperwork" },
      { value: "housing", label: "Housing & finding a place" },
      { value: "banking", label: "Banking, taxes & money" },
      { value: "career", label: "Job, career & local connections" },
    ],
  },
  {
    key: "workaround",
    title: "How do you currently find trustworthy help for this?",
    options: [
      { value: "ask_network", label: "Ask friends/family or Telegram groups" },
      { value: "search_myself", label: "Search Google/YouTube myself" },
      { value: "hired_online", label: "Hired someone online, hoping for the best" },
      { value: "no_reliable_help", label: "Haven't found reliable help yet" },
    ],
  },
  {
    key: "wtpSession",
    title: "Book a 15-min call with a vetted expert (lawyer, broker, accountant) — how much would you pay?",
    options: [
      { value: "free_only", label: "Only if it's free" },
      { value: "5_15", label: "$5–15" },
      { value: "15_30", label: "$15–30" },
      { value: "30_plus", label: "$30+" },
    ],
  },
  {
    key: "wtpSubscription",
    title: "How much would you pay per month for an app that helps you find trusted people & answers?",
    options: [
      { value: "free_only", label: "Nothing, free features only" },
      { value: "3_7", label: "$3–7/mo" },
      { value: "7_15", label: "$7–15/mo" },
      { value: "15_plus", label: "$15+/mo" },
    ],
  },
];

export const NEED_LABEL: Record<string, string> = {
  legal: "legal & visa help",
  housing: "housing & real estate",
  banking: "banking & accounting",
  career: "career & local connections",
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
