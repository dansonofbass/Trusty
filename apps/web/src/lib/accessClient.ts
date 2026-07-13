/**
 * Access client — the viewer's front-door state (invite-only gate). Powers the
 * AccessGuard redirect + the waitlist/onboarding screens.
 */

export type AccountStatus = "waitlisted" | "pending_onboarding" | "active";

export interface AccessState {
  status: AccountStatus;
  onboardingComplete: boolean;
  inviterId?: string;
  config: { inviteDefaultMaxUses: number; waitlistUnlockThreshold: number };
  waitlist?: {
    code: string;
    referralPath: string;
    referredCount: number;
    threshold: number;
    unlocked: boolean;
  };
}

/** Read access state. Returns null when unauthenticated or gating is off. */
export async function getAccess(): Promise<AccessState | null> {
  try {
    const r = await fetch("/api/access", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as AccessState;
  } catch {
    return null;
  }
}
