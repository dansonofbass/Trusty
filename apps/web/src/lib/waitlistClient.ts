/**
 * Waitlist client — join the waitlist + track referral-unlock progress.
 */

export interface WaitlistStatus {
  ok: boolean;
  code?: string;
  referralPath?: string;
  referredCount?: number;
  threshold?: number;
  unlocked?: boolean;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

/** Turn a referral code into the absolute shareable URL for the current origin. */
export function referralUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${code}`;
}

export async function joinWaitlist(email?: string): Promise<WaitlistStatus> {
  const r = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return (await jsonOrThrow(r)) as WaitlistStatus;
}

export async function waitlistStatus(): Promise<WaitlistStatus> {
  const r = await fetch("/api/waitlist", { cache: "no-store" });
  return (await jsonOrThrow(r)) as WaitlistStatus;
}
