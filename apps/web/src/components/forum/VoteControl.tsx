"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Up/down vote. Optimistic — the count moves on click and reverts if the
 * request fails, because waiting on a round-trip to see your own vote land
 * feels broken. Clicking your current vote again clears it (value 0).
 */
export default function VoteControl({
  score,
  myVote,
  onVote,
  size = "md",
}: {
  score: number;
  myVote: number;
  onVote: (value: number) => Promise<{ score: number; myVote: number }>;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState({ score, myVote });
  const [busy, setBusy] = useState(false);

  const cast = async (dir: number) => {
    if (busy) return;
    const next = state.myVote === dir ? 0 : dir;
    const prev = state; // snapshot to revert to if the write fails
    // Optimistic: drop the old vote's weight, add the new one.
    setState({ score: state.score - state.myVote + next, myVote: next });
    setBusy(true);
    try {
      const r = await onVote(next);
      setState({ score: r.score, myVote: r.myVote });
    } catch {
      setState({ score: prev.score, myVote: prev.myVote });
    } finally {
      setBusy(false);
    }
  };

  const icon = size === "sm" ? 14 : 16;
  const active = (dir: number) =>
    state.myVote === dir ? { color: dir > 0 ? "var(--color-accent)" : "#fda4af" } : { color: "var(--color-faint)" };

  return (
    <div className="flex shrink-0 flex-col items-center">
      <button
        type="button"
        onClick={() => void cast(1)}
        aria-label="Upvote"
        aria-pressed={state.myVote === 1}
        className="rounded transition hover:opacity-100 disabled:opacity-40"
        style={active(1)}
        disabled={busy}
      >
        <ChevronUp size={icon} />
      </button>
      <span
        className={`${size === "sm" ? "text-[11px]" : "text-[12px]"} font-bold tabular-nums`}
        style={{ color: state.myVote !== 0 ? active(state.myVote).color : "var(--color-dim)" }}
      >
        {state.score}
      </span>
      <button
        type="button"
        onClick={() => void cast(-1)}
        aria-label="Downvote"
        aria-pressed={state.myVote === -1}
        className="rounded transition hover:opacity-100 disabled:opacity-40"
        style={active(-1)}
        disabled={busy}
      >
        <ChevronDown size={icon} />
      </button>
    </div>
  );
}
