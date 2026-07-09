"use client";

import { Link2, X } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { ENTITY_LINK_PRESETS, type EntityLinkPreset } from "@constellation/graph-core";
import { NODE_COLOR } from "@/lib/palette";

export default function EntityLinkPicker({
  from,
  to,
  pending,
  onPick,
  onCancel,
}: {
  from: GNode;
  to: GNode | null;
  pending: boolean;
  onPick: (preset: EntityLinkPreset) => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="panel rise pointer-events-auto w-full max-w-lg p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg"
              style={{ background: "rgba(124,150,255,0.14)", color: "#7c96ff" }}
            >
              <Link2 size={15} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-ink">Link entities</div>
              <p className="text-[11.5px] text-[var(--color-dim)]">
                From{" "}
                <span style={{ color: NODE_COLOR[from.type] }}>{from.label}</span>
                {to ? (
                  <>
                    {" "}
                    → <span style={{ color: NODE_COLOR[to.type] }}>{to.label}</span>
                  </>
                ) : (
                  " — click another entity on the graph"
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cancel linking"
            className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)]"
            onClick={onCancel}
          >
            <X size={15} />
          </button>
        </div>

        {to && (
          <div className="grid gap-2 sm:grid-cols-2">
            {ENTITY_LINK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={pending}
                className="rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] px-3 py-2.5 text-left transition hover:border-[rgba(154,240,200,0.35)] hover:bg-[rgba(154,240,200,0.06)] disabled:opacity-50"
                onClick={() => onPick(preset)}
              >
                <div className="text-[12px] font-medium text-ink">{preset.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--color-faint)]">
                  {preset.description}
                </div>
                <div
                  className="mt-1.5 text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {preset.type === "SAME_AS" ? "local · same-as" : "local · relation"}
                </div>
              </button>
            ))}
          </div>
        )}

        {!to && (
          <p className="rounded-lg bg-[rgba(146,166,255,0.06)] px-3 py-2 text-[11.5px] text-[var(--color-dim)]">
            Local links appear only in your sky until others agree — then they become global.
          </p>
        )}
      </div>
    </div>
  );
}
