"use client";

import type { Layers } from "@/lib/store";
import { TRUST_ACCENT } from "@/lib/palette";

const MINT = "#9af0c8";

/**
 * Layer toggles — show/hide the Knowledge layer (extracted thoughts/concepts)
 * and the Trust layer (your directed trust edges) independently.
 */
export default function LayerToggle({
  layers,
  onToggle,
}: {
  layers: Layers;
  onToggle: (k: keyof Layers) => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 backdrop-blur-md">
      <Pill on={layers.knowledge} color={MINT} label="Knowledge" onClick={() => onToggle("knowledge")} />
      <Pill on={layers.trust} color={TRUST_ACCENT} label="Trust" onClick={() => onToggle("trust")} />
    </div>
  );
}

function Pill({
  on,
  color,
  label,
  onClick,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition"
      style={{
        background: on ? `${color}22` : "transparent",
        color: on ? "var(--color-ink)" : "var(--color-faint)",
      }}
      title={on ? `Hide ${label} layer` : `Show ${label} layer`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: on ? color : "transparent", border: `1px solid ${color}` }}
      />
      {label}
    </button>
  );
}
