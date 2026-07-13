/**
 * Onboarding state — server-authoritative + resumable (spec #4).
 *
 * Onboarding is NOT profile creation; it exists only to deliver the first useful
 * recommendation in under a minute. We persist progress per step so a user can
 * resume on another device / after a reload, and so completion can gate the
 * transition from `pending_onboarding` → `active` account status.
 *
 * Steps answer one question each: welcome → topics → looking_for → profile →
 * first_rec → done. Persisted values are the minimum needed to personalize the
 * first recommendation; nothing here is a trust action or a graph edge.
 *
 * Degrades gracefully without DATABASE_URL (returns an empty, non-completed state
 * so the UI can still run in open/dev mode).
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export type OnboardingStep =
  | "welcome"
  | "topics"
  | "looking_for"
  | "profile"
  | "first_rec"
  | "done";

export interface OnboardingProfile {
  name?: string;
  city?: string;
  language?: string;
  photo?: string;
}

export interface OnboardingState {
  step: OnboardingStep;
  topics: string[];
  lookingFor: string[];
  profile: OnboardingProfile;
  completed: boolean;
}

export interface OnboardingPatch {
  step?: OnboardingStep;
  topics?: string[];
  lookingFor?: string[];
  profile?: OnboardingProfile;
}

const EMPTY: OnboardingState = {
  step: "welcome",
  topics: [],
  lookingFor: [],
  profile: {},
  completed: false,
};

export function onboardingEnabled(): boolean {
  return !!pool;
}

export async function initOnboarding(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — onboarding state disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS onboarding_state (
      user_id      TEXT PRIMARY KEY,
      step         TEXT NOT NULL DEFAULT 'welcome',
      topics       JSONB NOT NULL DEFAULT '[]'::jsonb,
      looking_for  JSONB NOT NULL DEFAULT '[]'::jsonb,
      profile      JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  pool = p;
  console.log("graph-service: onboarding state ready (postgres)");
}

function rowToState(row: pg.QueryResultRow): OnboardingState {
  return {
    step: (row.step as OnboardingStep) ?? "welcome",
    topics: Array.isArray(row.topics) ? row.topics : [],
    lookingFor: Array.isArray(row.looking_for) ? row.looking_for : [],
    profile: (row.profile as OnboardingProfile) ?? {},
    completed: !!row.completed_at,
  };
}

export async function getOnboarding(userId: string): Promise<OnboardingState> {
  if (!pool) return { ...EMPTY };
  const r = await pool.query(`SELECT * FROM onboarding_state WHERE user_id = $1`, [userId]);
  return r.rows[0] ? rowToState(r.rows[0]) : { ...EMPTY };
}

const asStrArray = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 40) : null;

/** Merge a step's data. Only the provided fields are written (COALESCE-style). */
export async function saveStep(userId: string, patch: OnboardingPatch): Promise<OnboardingState> {
  if (!pool) return { ...EMPTY, ...normalizePatch(patch) };
  const topics = asStrArray(patch.topics);
  const lookingFor = asStrArray(patch.lookingFor);
  const profile = patch.profile ?? null;
  await pool.query(
    `INSERT INTO onboarding_state (user_id, step, topics, looking_for, profile, updated_at)
       VALUES ($1, COALESCE($2, 'welcome'),
               COALESCE($3::jsonb, '[]'::jsonb),
               COALESCE($4::jsonb, '[]'::jsonb),
               COALESCE($5::jsonb, '{}'::jsonb), now())
     ON CONFLICT (user_id) DO UPDATE SET
       step        = COALESCE($2, onboarding_state.step),
       topics      = COALESCE($3::jsonb, onboarding_state.topics),
       looking_for = COALESCE($4::jsonb, onboarding_state.looking_for),
       profile     = COALESCE($5::jsonb, onboarding_state.profile),
       updated_at  = now()`,
    [
      userId,
      patch.step ?? null,
      topics ? JSON.stringify(topics) : null,
      lookingFor ? JSON.stringify(lookingFor) : null,
      profile ? JSON.stringify(profile) : null,
    ],
  );
  return getOnboarding(userId);
}

function normalizePatch(patch: OnboardingPatch): Partial<OnboardingState> {
  return {
    ...(patch.step ? { step: patch.step } : {}),
    ...(patch.topics ? { topics: asStrArray(patch.topics) ?? [] } : {}),
    ...(patch.lookingFor ? { lookingFor: asStrArray(patch.lookingFor) ?? [] } : {}),
    ...(patch.profile ? { profile: patch.profile } : {}),
  };
}

/**
 * Mark onboarding complete. Returns true only on the FIRST completion (so the
 * caller fires the INVITED edge + referral-unlock exactly once). Idempotent and
 * race-safe: the `completed_at IS NULL` guard makes the winning UPDATE atomic.
 */
export async function completeOnboarding(userId: string): Promise<boolean> {
  if (!pool) return true;
  // Ensure the row exists without clobbering existing progress.
  await pool.query(
    `INSERT INTO onboarding_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const r = await pool.query(
    `UPDATE onboarding_state
        SET step = 'done', completed_at = now(), updated_at = now()
      WHERE user_id = $1 AND completed_at IS NULL
      RETURNING user_id`,
    [userId],
  );
  return (r.rowCount ?? 0) > 0;
}
