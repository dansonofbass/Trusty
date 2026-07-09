"use client";

import { Plus, X } from "lucide-react";
import type { Wallet } from "@constellation/graph-core";
import { GOLD, withAlpha } from "@/lib/palette";

const REASON_LABEL: Record<string, string> = {
  start: "Starting balance",
  buy: "Bought tokens",
  thought: "Wrote a thought",
  promotion: "Your link was adopted",
  peek: "Peeked beyond your galaxy",
};

function relTime(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function WalletPanel({
  wallet,
  pending,
  onBuy,
  onClose,
}: {
  wallet: Wallet;
  pending: boolean;
  onBuy: () => void;
  onClose: () => void;
}) {
  const ledger = [...(wallet.ledger ?? [])].reverse(); // newest first

  return (
    <div className="panel rise absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold" style={{ color: GOLD, fontFamily: "var(--font-mono)" }}>
              ✦ {wallet.balance}
            </span>
            <span className="text-[11px] text-[var(--color-faint)]">tokens</span>
          </div>
          <div className="text-[10.5px] text-[var(--color-faint)]">
            {wallet.earnedTotal} earned by contributing
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)] hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <p className="mb-3 rounded-lg bg-[rgba(146,166,255,0.06)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-dim)]">
        Tokens gate what you can see. <b>Earn</b> them by writing and when your links get adopted
        into the global graph; <b>spend</b> them to peek at regions you have no social path to.
      </p>

      <button
        type="button"
        className="btn btn-gold mb-3 w-full justify-center"
        disabled={pending}
        onClick={onBuy}
      >
        <Plus size={13} /> Buy 10 tokens
      </button>

      <div className="eyebrow mb-1.5">Activity</div>
      {ledger.length === 0 ? (
        <p className="py-2 text-[11px] text-[var(--color-faint)]">
          No activity yet — write something or peek to see your token history.
        </p>
      ) : (
        <ul className="-mr-1 flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-1 scroll-quiet">
          {ledger.map((e, i) => {
            const earn = e.delta >= 0;
            return (
              <li key={i} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span
                  className="grid h-5 w-9 shrink-0 place-items-center rounded text-[11px] font-semibold"
                  style={{
                    background: withAlpha(earn ? "#54d26e" : "#ff6157", 0.14),
                    color: earn ? "#7ee08f" : "#ff9a90",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {earn ? "+" : ""}
                  {e.delta}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-dim)]">
                  {REASON_LABEL[e.reason] ?? e.reason}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{relTime(e.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
