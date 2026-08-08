/**
 * Public market-test survey — fully anonymous (#market-test).
 *
 * No login, no user_id: this is the thing being shared as a link to find out
 * whether Trusty answers real needs before investing in the paid-consulting
 * pivot. Five 4-option questions, one insert per completed survey. Degrades
 * gracefully without DATABASE_URL, like onboarding.ts/specialists.ts.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function surveyEnabled(): boolean {
  return !!pool;
}

export async function initSurvey(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — survey disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id                BIGSERIAL PRIMARY KEY,
      stage             TEXT NOT NULL,
      biggest_need      TEXT NOT NULL,
      topic             TEXT NOT NULL,
      workaround        TEXT NOT NULL,
      wtp_session       TEXT NOT NULL,
      wtp_subscription  TEXT NOT NULL,
      matches_shown     BOOLEAN NOT NULL DEFAULT false,
      joined            BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS survey_responses_topic_idx ON survey_responses(topic)`);
  await p.query(`CREATE INDEX IF NOT EXISTS survey_responses_created_idx ON survey_responses(created_at)`);
  pool = p;
  console.log("graph-service: survey ready (postgres)");
}

const ANSWER_OPTIONS = {
  stage: ["exploring", "planning", "recently_arrived", "settled"],
  biggestNeed: ["legal", "housing", "banking", "career"],
  workaround: ["ask_network", "search_myself", "hired_online", "no_reliable_help"],
  wtpSession: ["free_only", "5_15", "15_30", "30_plus"],
  wtpSubscription: ["free_only", "3_7", "7_15", "15_plus"],
} as const;

/** Biggest-need answer -> TOPIC_TAXONOMY value, so the same answer drives
 *  circle + specialist matching without a separate mapping table elsewhere. */
export const NEED_TOPIC: Record<string, string> = {
  legal: "immigration",
  housing: "real_estate",
  banking: "accountant",
  career: "technology",
};

export interface SurveyAnswers {
  stage: string;
  biggestNeed: string;
  workaround: string;
  wtpSession: string;
  wtpSubscription: string;
}

export function validateSurveyAnswers(raw: unknown): SurveyAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  for (const [key, options] of Object.entries(ANSWER_OPTIONS)) {
    const v = a[key];
    if (typeof v !== "string" || !(options as readonly string[]).includes(v)) return null;
  }
  return {
    stage: a.stage as string,
    biggestNeed: a.biggestNeed as string,
    workaround: a.workaround as string,
    wtpSession: a.wtpSession as string,
    wtpSubscription: a.wtpSubscription as string,
  };
}

export async function submitSurveyResponse(
  answers: SurveyAnswers,
): Promise<{ id: string; topic: string }> {
  const topic = NEED_TOPIC[answers.biggestNeed] ?? answers.biggestNeed;
  if (!pool) return { id: "disabled", topic };
  const r = await pool.query(
    `INSERT INTO survey_responses (stage, biggest_need, topic, workaround, wtp_session, wtp_subscription)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [answers.stage, answers.biggestNeed, topic, answers.workaround, answers.wtpSession, answers.wtpSubscription],
  );
  return { id: String(r.rows[0].id), topic };
}

export async function markMatchesShown(id: string): Promise<void> {
  if (!pool || id === "disabled") return;
  await pool.query(`UPDATE survey_responses SET matches_shown = true WHERE id = $1`, [id]);
}

export async function markJoined(id: string): Promise<void> {
  if (!pool || id === "disabled") return;
  await pool.query(`UPDATE survey_responses SET joined = true WHERE id = $1`, [id]);
}

/* ------------------------------ admin reads ------------------------------ */

export interface SurveySummary {
  total: number;
  matchesShownRate: number;
  joinedRate: number;
  breakdown: Record<keyof typeof ANSWER_OPTIONS, Record<string, number>>;
  topicCounts: Record<string, number>;
}

const COLUMN_FOR: Record<keyof typeof ANSWER_OPTIONS, string> = {
  stage: "stage",
  biggestNeed: "biggest_need",
  workaround: "workaround",
  wtpSession: "wtp_session",
  wtpSubscription: "wtp_subscription",
};

export async function surveySummary(): Promise<SurveySummary> {
  const empty: SurveySummary = {
    total: 0, matchesShownRate: 0, joinedRate: 0,
    breakdown: { stage: {}, biggestNeed: {}, workaround: {}, wtpSession: {}, wtpSubscription: {} },
    topicCounts: {},
  };
  if (!pool) return empty;
  const totals = await pool.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE matches_shown) AS shown,
            count(*) FILTER (WHERE joined) AS joined
       FROM survey_responses`,
  );
  const total = Number(totals.rows[0]?.total ?? 0);
  const shown = Number(totals.rows[0]?.shown ?? 0);
  const joined = Number(totals.rows[0]?.joined ?? 0);

  const breakdown = { stage: {}, biggestNeed: {}, workaround: {}, wtpSession: {}, wtpSubscription: {} } as SurveySummary["breakdown"];
  for (const key of Object.keys(ANSWER_OPTIONS) as (keyof typeof ANSWER_OPTIONS)[]) {
    const col = COLUMN_FOR[key];
    const r = await pool.query(`SELECT ${col} AS v, count(*) AS c FROM survey_responses GROUP BY ${col}`);
    for (const row of r.rows) breakdown[key][String(row.v)] = Number(row.c);
  }

  const topicRows = await pool.query(`SELECT topic, count(*) AS c FROM survey_responses GROUP BY topic ORDER BY c DESC`);
  const topicCounts: Record<string, number> = {};
  for (const row of topicRows.rows) topicCounts[String(row.topic)] = Number(row.c);

  return {
    total,
    matchesShownRate: total ? shown / total : 0,
    joinedRate: total ? joined / total : 0,
    breakdown,
    topicCounts,
  };
}
