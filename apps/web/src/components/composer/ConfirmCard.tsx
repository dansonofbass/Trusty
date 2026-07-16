"use client";

import { useState } from "react";
import { Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";
import { GOLD } from "@/lib/palette";

/**
 * Confirm card for gated agent actions (#29) — outward-facing tools (publish,
 * ask, trust, listen) never auto-execute. The agent proposes args; the user can
 * edit the human fields (topic/geo/note) before approving. Deny feeds a reason
 * back to the model so it adapts instead of retrying.
 */
export interface PendingConfirm {
  id: string;
  tool: string;
  args: unknown;
  title: string;
  description: string;
  decided?: "approved" | "denied";
}

/** Arg keys the user may edit on the card, in display order. */
const EDITABLE_KEYS = ["topic", "geo", "note"] as const;

export default function ConfirmCard({
  confirm,
  busy,
  onDecide,
}: {
  confirm: PendingConfirm;
  busy: boolean;
  onDecide: (approved: boolean, args?: unknown) => void;
}) {
  const baseArgs =
    confirm.args && typeof confirm.args === "object" ? (confirm.args as Record<string, unknown>) : {};
  const [edits, setEdits] = useState<Record<string, string>>({});

  const value = (k: string) => edits[k] ?? (typeof baseArgs[k] === "string" ? (baseArgs[k] as string) : "");
  const mergedArgs = () => {
    const out: Record<string, unknown> = { ...baseArgs };
    for (const [k, v] of Object.entries(edits)) {
      if (v.trim()) out[k] = v.trim();
      else delete out[k];
    }
    return out;
  };

  if (confirm.decided) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-space/40 px-2.5 py-1.5 text-[11.5px] text-[var(--color-faint)]">
        {confirm.decided === "approved" ? <Check size={12} className="text-[#54d26e]" /> : <X size={12} />}
        {confirm.title} — {confirm.decided}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border p-3" style={{ borderColor: "rgba(255,217,122,0.45)", background: "rgba(255,217,122,0.06)" }}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
        <ShieldQuestion size={14} style={{ color: GOLD }} /> {confirm.title}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-dim)]">{confirm.description}</p>

      <div className="mt-2 space-y-1.5">
        {EDITABLE_KEYS.filter((k) => k in baseArgs || k === "note").map((k) =>
          k === "topic" ? (
            <label key={k} className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0 capitalize">{k}</span>
              <select
                value={value(k)}
                onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1 text-ink"
              >
                {[value(k), ...TOPIC_TAXONOMY.filter((t) => t !== value(k))].filter(Boolean).map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
          ) : (
            <label key={k} className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0 capitalize">{k}</span>
              <input
                value={value(k)}
                onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={k === "geo" ? "anywhere" : "optional"}
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1 text-ink outline-none placeholder:text-[var(--color-faint)]"
              />
            </label>
          ),
        )}
        {/* Non-editable args (ids etc.) shown for transparency. */}
        {Object.entries(baseArgs)
          .filter(([k]) => !(EDITABLE_KEYS as readonly string[]).includes(k))
          .map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[10.5px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0 capitalize">{k}</span>
              <span className="truncate" style={{ fontFamily: "var(--font-mono)" }}>{typeof v === "string" ? v : JSON.stringify(v)}</span>
            </div>
          ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(true, mergedArgs())}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-50"
          style={{ background: GOLD }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(false)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-[var(--color-dim)] hover:text-ink disabled:opacity-50"
        >
          <X size={13} /> Not now
        </button>
      </div>
    </div>
  );
}
