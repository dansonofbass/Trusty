/**
 * Onboarding client — resumable, server-persisted onboarding steps + the first
 * recommendation from the inviter's network.
 */

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

export interface FirstRec {
  nodeId: string;
  label: string;
  score: number;
  reason: string;
  sub?: string;
  entityType?: string;
  viaLabels: string[];
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

export async function getOnboarding(): Promise<OnboardingState> {
  const r = await fetch("/api/onboarding", { cache: "no-store" });
  return (await jsonOrThrow(r)) as OnboardingState;
}

export async function saveStep(patch: OnboardingPatch): Promise<OnboardingState> {
  const r = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await jsonOrThrow(r)) as OnboardingState;
}

export async function completeOnboarding(): Promise<{ ok: boolean; status: string }> {
  const r = await fetch("/api/onboarding/complete", { method: "POST" });
  return (await jsonOrThrow(r)) as { ok: boolean; status: string };
}

export async function getFirstRec(
  topic: string,
): Promise<{ recommendations: FirstRec[]; seededFrom?: string }> {
  const r = await fetch(`/api/onboarding/first-rec?topic=${encodeURIComponent(topic)}`, {
    cache: "no-store",
  });
  return (await jsonOrThrow(r)) as { recommendations: FirstRec[]; seededFrom?: string };
}
