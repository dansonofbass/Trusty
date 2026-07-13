"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccess } from "@/lib/accessClient";
import { joinWaitlist, referralUrl, waitlistStatus, type WaitlistStatus } from "@/lib/waitlistClient";

/**
 * Waitlist screen — the controlled-growth front door for non-invited visitors.
 * Never a dead end and never framed as rejection: you get a personal referral
 * link and unlock automatically once enough friends join. If a referral push has
 * already unlocked access, we send you straight into onboarding.
 */
export default function WaitlistPage() {
  const router = useRouter();
  const [state, setState] = useState<WaitlistStatus | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    // If a referral push already unlocked us, jump to onboarding.
    const access = await getAccess();
    if (access && access.status !== "waitlisted") {
      router.replace(access.onboardingComplete ? "/" : "/onboarding");
      return;
    }
    try {
      setState(await waitlistStatus());
    } catch {
      setState({ ok: false });
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await joinWaitlist(email.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const joined = state?.ok && state.code;
  const link = joined ? referralUrl(state!.code!) : "";
  const count = state?.referredCount ?? 0;
  const threshold = state?.threshold ?? 3;
  const remaining = Math.max(0, threshold - count);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05060d] px-5 py-10 text-ink">
      <section className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-line bg-[rgba(14,16,30,0.72)] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
          <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-faint">Trusty is invite-only</p>

          {!joined ? (
            <>
              <h1
                className="mt-2 text-[26px] font-extrabold leading-tight text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Join the <span className="text-gold">waitlist</span>
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-dim">
                We grow the network carefully to keep trust high. Join the list and
                get a personal referral link — invite {threshold} friends who join and
                your access unlocks automatically.
              </p>
              <label className="mt-6 block text-[12px] font-medium uppercase tracking-[0.14em] text-faint">
                Email (so we can reach you)
              </label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl border border-line bg-[rgba(255,255,255,0.04)] px-4 py-3 text-[15px] text-ink outline-none focus:border-gold"
              />
              {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
              <button
                onClick={join}
                disabled={busy}
                className="mt-5 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110 disabled:opacity-60"
                style={{
                  fontFamily: "var(--font-display)",
                  background: "linear-gradient(180deg,#ffe08a,#ffc24d)",
                }}
              >
                {busy ? "Joining…" : "Join the waitlist"}
              </button>
            </>
          ) : (
            <>
              <h1
                className="mt-2 text-[26px] font-extrabold leading-tight text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                You're on the list ✦
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-dim">
                {remaining > 0 ? (
                  <>
                    Invite <b className="text-ink">{remaining}</b> more{" "}
                    {remaining === 1 ? "person" : "people"} who join and complete
                    setup — then your access unlocks.
                  </>
                ) : (
                  <>Your referrals are in — refresh to enter.</>
                )}
              </p>

              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className="h-full rounded-full bg-gold transition-all"
                  style={{ width: `${Math.min(100, (count / threshold) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[13px] text-faint">
                {count} / {threshold} joined
              </p>

              <label className="mt-6 block text-[12px] font-medium uppercase tracking-[0.14em] text-faint">
                Your referral link
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-[rgba(255,255,255,0.04)] px-3 py-2.5 text-[13px] text-dim outline-none"
                />
                <button
                  onClick={copy}
                  className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-[13px] font-semibold text-ink transition hover:border-gold"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <button
                onClick={refresh}
                className="mt-6 block w-full text-center text-[13px] text-dim underline-offset-4 hover:text-ink hover:underline"
              >
                Refresh status
              </button>
            </>
          )}
        </div>
        <p className="mt-5 text-center text-[11.5px] text-faint">
          Trust-powered recommendations · your connections stay private
        </p>
      </section>
    </main>
  );
}
