"use client";

import { useEffect, useState } from "react";
import { Coins, Loader2, Sparkles, X, Zap } from "lucide-react";
import { GOLD } from "@/lib/palette";

/**
 * "My contribution" — the user-visible face of the Contribution Engine
 * (#21/#22) and Credits (#23): how much you've helped the network, what it
 * earned you (Listen slots + credits), and why — always explained as real
 * graph improvements, never points.
 */

interface ContributionData {
  score: { score: number; stage: string; events: number };
  explanations: string[];
  timeline: { kind: string; label: string; status: string; at: string }[];
}
interface CreditsData {
  balance: number;
  earned: number;
  ledger: number;
  config: { pointsPerCredit: number; boost: { cost: number; days: number; slots: number } };
}
interface ListenData {
  slots: {
    used: number;
    capacity: number;
    remaining: number;
    breakdown?: { base: number; fromContribution: number; fromTenure: number; fromBoosts: number };
  };
}

const STATUS_HINT: Record<string, string> = {
  recorded: "awaiting review",
  validated: "verified",
  accepted: "approved",
  rejected: "not accepted",
};

export default function ContributionPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ c: ContributionData; cr: CreditsData; l: ListenData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [boostMsg, setBoostMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const [c, cr, l] = await Promise.all([
        fetch("/api/contribution", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/credits", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/listen", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setData({ c, cr, l });
    } catch {
      setError("Couldn't load your contribution right now.");
    }
  };
  useEffect(() => { void load(); }, []);

  const boost = async () => {
    setBoosting(true);
    setBoostMsg(null);
    try {
      const r = await fetch("/api/credits/boost", { method: "POST" });
      const body = await r.json();
      if (r.ok) {
        setBoostMsg(`Boost active — +${data?.cr.config.boost.slots ?? 1} slot until ${new Date(body.expiresAt).toLocaleDateString()}`);
        await load();
      } else {
        setBoostMsg(body.error ?? "Boost unavailable.");
      }
    } finally {
      setBoosting(false);
    }
  };

  return (
    <div className="panel rise absolute right-0 top-[calc(100%+10px)] z-50 w-[340px] p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          <Sparkles size={13} /> My contribution
        </div>
        <button type="button" aria-label="Close" onClick={onClose}
          className="rounded-lg p-1 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)] hover:text-ink">
          <X size={14} />
        </button>
      </div>

      {error && <div className="text-[12px] text-rose-300">{error}</div>}
      {!data && !error && <div className="flex items-center gap-2 py-4 text-[12px] text-[var(--color-faint)]"><Loader2 className="animate-spin" size={14} /> Loading…</div>}

      {data && (
        <>
          {/* headline: score + stage */}
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-bold" style={{ color: GOLD, fontFamily: "var(--font-mono)" }}>
              {data.c.score.score}
            </span>
            <span className="rounded-full bg-[rgba(255,217,122,0.12)] px-2 py-0.5 text-[10.5px] font-semibold" style={{ color: GOLD }}>
              {data.c.score.stage}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-faint)]">
            Grows when your knowledge genuinely helps others — never from clicks or activity.
          </p>

          {/* what it earns: slots + credits */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.05)] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">Listen slots</div>
              <div className="mt-0.5 text-[16px] font-bold text-ink" style={{ fontFamily: "var(--font-mono)" }}>
                {data.l.slots.used}<span className="text-[var(--color-faint)]">/{data.l.slots.capacity}</span>
              </div>
              {data.l.slots.breakdown && (
                <div className="text-[10px] leading-snug text-[var(--color-faint)]">
                  {data.l.slots.breakdown.base} base
                  {data.l.slots.breakdown.fromContribution > 0 && ` +${data.l.slots.breakdown.fromContribution} earned`}
                  {data.l.slots.breakdown.fromTenure > 0 && ` +${data.l.slots.breakdown.fromTenure} tenure`}
                  {data.l.slots.breakdown.fromBoosts > 0 && ` +${data.l.slots.breakdown.fromBoosts} boost`}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-[rgba(255,217,122,0.25)] bg-[rgba(255,217,122,0.05)] p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
                <Coins size={10} /> Credits
              </div>
              <div className="mt-0.5 text-[16px] font-bold" style={{ color: GOLD, fontFamily: "var(--font-mono)" }}>
                {data.cr.balance}
              </div>
              <div className="text-[10px] leading-snug text-[var(--color-faint)]">
                {data.cr.earned} earned{data.cr.ledger !== 0 ? ` ${data.cr.ledger > 0 ? "+" : ""}${data.cr.ledger} granted/spent` : ""}
              </div>
            </div>
          </div>

          {/* boost action */}
          <button
            onClick={() => void boost()}
            disabled={boosting || data.cr.balance < data.cr.config.boost.cost}
            title={data.cr.balance < data.cr.config.boost.cost ? `Needs ${data.cr.config.boost.cost} credits` : undefined}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[rgba(255,217,122,0.3)] bg-[rgba(255,217,122,0.08)] px-3 py-1.5 text-[12px] font-semibold transition hover:border-[rgba(255,217,122,0.5)] disabled:opacity-40"
            style={{ color: GOLD }}
          >
            {boosting ? <Loader2 className="animate-spin" size={13} /> : <Zap size={13} />}
            +{data.cr.config.boost.slots} Listen slot for {data.cr.config.boost.days} days · {data.cr.config.boost.cost} credits
          </button>
          {boostMsg && <div className="mt-1.5 text-[11px] text-[var(--color-dim)]">{boostMsg}</div>}

          {/* why the score is what it is */}
          {data.c.explanations.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">Why</div>
              <ul className="space-y-1">
                {data.c.explanations.slice(0, 4).map((e) => (
                  <li key={e} className="text-[11.5px] leading-snug text-[var(--color-dim)]">· {e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* recent history */}
          {data.c.timeline.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-line)] pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">Recent</div>
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {data.c.timeline.slice(0, 6).map((t, i) => (
                  <li key={`${t.kind}_${t.at}_${i}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate text-[var(--color-dim)]">{t.label}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{STATUS_HINT[t.status] ?? t.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.c.score.events === 0 && (
            <p className="mt-3 rounded-lg bg-[rgba(146,166,255,0.06)] p-2 text-[11px] leading-snug text-[var(--color-faint)]">
              Share a recommendation, report how one worked out, or suggest a correction to a place —
              validated improvements grow your score, slots and credits.
            </p>
          )}
        </>
      )}
    </div>
  );
}
