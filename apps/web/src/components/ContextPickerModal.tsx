"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { contextsForTopic } from "@constellation/graph-core";

/**
 * Context picker — "for what situation?" as a proper modal instead of a
 * cramped free-text input. Topic-aware presets (date night, family visa case,
 * emergency…) as a tappable grid, plus a custom escape hatch. The chosen
 * context applies to the whole recommendation wizard.
 */
export default function ContextPickerModal({
  topic,
  value,
  onPick,
  onClose,
}: {
  topic: string;
  value?: string;
  /** Canonical snake_case context, or undefined for "no context". */
  onPick: (context: string | undefined) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");
  const options = contextsForTopic(topic);

  const pick = (v: string | undefined) => {
    onPick(v);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[rgba(4,6,16,0.62)] backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="rise relative z-10 w-full max-w-[420px] overflow-hidden rounded-[20px] border border-line bg-[var(--color-card)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="min-w-0 flex-1 text-[14px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            What&apos;s this for?
          </h3>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
            {topic.replace(/_/g, " ")}
          </span>
          <button type="button" aria-label="Close" onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[var(--color-tint)] hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <div className="scroll-quiet max-h-[54vh] overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            {options.map((c) => {
              const active = value === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => pick(c.value)}
                  className="flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition"
                  style={
                    active
                      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                      : { borderColor: "var(--color-line)", background: "var(--color-tint-soft)" }
                  }
                >
                  <span className="text-[18px]">{c.glyph}</span>
                  <span className="min-w-0 flex-1 text-[12px] font-medium capitalize leading-tight"
                    style={{ color: active ? "var(--color-accent)" : "var(--color-ink)" }}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* custom escape hatch */}
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = custom.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 60);
              if (v) pick(v);
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="something else…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--color-tint-soft)] px-2.5 py-2 text-[12px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)]"
            />
            <button type="submit" disabled={!custom.trim()} className="btn shrink-0 disabled:opacity-45">
              Use
            </button>
          </form>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <button type="button" onClick={() => pick(undefined)}
            className="text-[11.5px] text-[var(--color-faint)] hover:text-ink">
            No specific context
          </button>
          <span className="text-[10px] text-[var(--color-faint)]">
            helps searches match the right situation
          </span>
        </div>
      </div>
    </div>
  );
}
