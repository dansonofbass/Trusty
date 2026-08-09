"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { listPendingOutcomes, resolveOutcome, type PendingPrompt } from "@/lib/outcomeClient";
import { useT } from "@/lib/i18n";

/**
 * The follow-up half of the outcome loop: after you act on a provider, this
 * proactively asks "did it work out with X?" on a later visit. A worked/didn't
 * answer writes the authoritative outcome that re-ranks your network's trust —
 * the verified-outcome data moat. One prompt at a time so it never nags.
 */
export default function OutcomePrompts() {
  const t = useT();
  const [queue, setQueue] = useState<PendingPrompt[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listPendingOutcomes()
      .then(setQueue)
      .catch(() => undefined);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const advance = () => setQueue((q) => q.slice(1));

  const answer = async (value: number) => {
    setBusy(true);
    try {
      await resolveOutcome(current.id, value);
    } catch {
      /* best-effort — drop it from the queue regardless */
    } finally {
      setBusy(false);
      advance();
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div className="rise pointer-events-auto w-full max-w-md rounded-2xl border border-line bg-nebula/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: TRUST_ACCENT }}
            >
              Did it work out?
            </div>
            <p className="mt-1 text-[14px] leading-snug text-ink">
              You looked up <b>{current.label}</b>
              {current.topic ? ` for a ${current.topic.replace(/_/g, " ")}` : ""}
              {current.geo ? ` in ${current.geo}` : ""}. How did it go?
            </p>
          </div>
          <button
            type="button"
            aria-label={t("outcome.notYet")}
            onClick={advance}
            className="shrink-0 text-faint hover:text-ink"
            title={t("outcome.notYetHint")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(1)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13.5px] font-bold text-space disabled:opacity-60"
            style={{ background: TRUST_ACCENT }}
          >
            <ThumbsUp size={14} /> Worked out
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(-1)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[13.5px] font-semibold text-ink disabled:opacity-60"
            style={{ borderColor: withAlpha(TRUST_ACCENT, 0.5) }}
          >
            <ThumbsDown size={14} /> Didn&apos;t
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={advance}
            className="rounded-xl border border-line px-3 py-2.5 text-[13px] text-dim disabled:opacity-60"
          >
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
