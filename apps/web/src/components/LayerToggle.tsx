"use client";

import type { Layers } from "@/lib/store";
import { TRUST_ACCENT } from "@/lib/palette";
import { useT, type Translate } from "@/lib/i18n";

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
  const t = useT();
  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 backdrop-blur-md">
      <Pill on={layers.knowledge} color={MINT} label={t("graph.layerKnowledge")} onClick={() => onToggle("knowledge")} t={t} />
      <Pill on={layers.trust} color={TRUST_ACCENT} label={t("graph.layerTrust")} onClick={() => onToggle("trust")} t={t} />
    </div>
  );
}

function Pill({
  on,
  color,
  label,
  onClick,
  t,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
  t: Translate;
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
      title={on ? t("graph.hideLayer", { layer: label }) : t("graph.showLayer", { layer: label })}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: on ? color : "transparent", border: `1px solid ${color}` }}
      />
      {label}
    </button>
  );
}
