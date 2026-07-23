"use client";

import { ArrowLeftRight, Eye, EyeOff, RotateCcw } from "lucide-react";
import type { CommunityInfo, NodeType } from "@constellation/graph-core";
import { NODE_TYPE_LABEL } from "@constellation/graph-core";
import { NODE_COLOR, communityColor, withAlpha } from "@/lib/palette";
import type { SourceMode } from "@/lib/dataSource";
import { useUI } from "@/lib/store";

const TYPE_ORDER: NodeType[] = [
  "person",
  "book",
  "news",
  "music",
  "video",
  "social_account",
  "post",
  "movie",
  "financial_signal",
  "location",
  "thought",
  "concept",
];

export default function LeftRail({
  counts,
  communities,
  mode,
  onSwitchMode,
  onReset,
}: {
  counts: Record<string, number>;
  communities: CommunityInfo[];
  mode: SourceMode;
  onSwitchMode: () => void;
  onReset: () => void;
}) {
  const view = useUI((s) => s.view);
  const hiddenTypes = useUI((s) => s.hiddenTypes);
  const toggleType = useUI((s) => s.toggleType);
  const setHiddenTypes = useUI((s) => s.setHiddenTypes);
  const circleFilter = useUI((s) => s.circleFilter);
  const setCircleFilter = useUI((s) => s.setCircleFilter);

  // Types that actually exist in the graph (don't show empty rows).
  const present = TYPE_ORDER.filter((t) => (counts[t] ?? 0) > 0);
  const anyHidden = hiddenTypes.length > 0;
  const soloType = (t: NodeType) => setHiddenTypes(present.filter((x) => x !== t));

  return (
    <aside
      className="rise absolute left-4 top-14 z-30 hidden w-[218px] flex-col gap-3 md:flex"
      style={{ animationDelay: "0.12s" }}
    >
      <div className="panel p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="eyebrow">Lens · node types</span>
          <button
            type="button"
            onClick={() => setHiddenTypes([])}
            disabled={!anyHidden}
            className="text-[10.5px] text-[var(--color-faint)] transition enabled:hover:text-ink disabled:opacity-40"
          >
            Show all
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {present.map((t) => {
            const hidden = hiddenTypes.includes(t);
            return (
              <li
                key={t}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[rgba(146,166,255,0.08)]"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full transition"
                  style={{
                    background: NODE_COLOR[t],
                    boxShadow: hidden ? "none" : `0 0 8px ${withAlpha(NODE_COLOR[t], 0.7)}`,
                    opacity: hidden ? 0.4 : 1,
                  }}
                />
                <span
                  className="flex-1 truncate text-[13px] text-ink transition"
                  style={{
                    opacity: hidden ? 0.45 : 1,
                    textDecoration: hidden ? "line-through" : "none",
                  }}
                >
                  {NODE_TYPE_LABEL[t]}
                </span>
                {/* "only" (solo) — hover affordance */}
                <button
                  type="button"
                  onClick={() => soloType(t)}
                  title={`Show only ${NODE_TYPE_LABEL[t]}`}
                  className="text-[10px] uppercase tracking-wide text-[var(--color-faint)] opacity-0 transition hover:text-ink group-hover:opacity-100"
                >
                  only
                </button>
                <span
                  className="font-mono text-[11px] text-[var(--color-faint)]"
                  style={{ fontFamily: "var(--font-mono)", opacity: hidden ? 0.45 : 1 }}
                >
                  {counts[t] ?? 0}
                </span>
                {/* always-visible show/hide toggle */}
                <button
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={!hidden}
                  title={hidden ? "Show" : "Hide"}
                  className="shrink-0 rounded p-0.5 text-[var(--color-faint)] transition hover:text-ink"
                >
                  {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {view === "circles" && communities.length > 0 && (
        <div className="panel max-h-[34vh] overflow-auto p-3.5 scroll-quiet">
          <div className="eyebrow mb-2.5">Circles · communities</div>
          <ul className="flex flex-col gap-0.5">
            {communities.map((c) => {
              const active = circleFilter === c.id;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setCircleFilter(active ? null : c.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[rgba(146,166,255,0.08)]"
                    style={{
                      background: active ? withAlpha(communityColor(c.id), 0.12) : undefined,
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: communityColor(c.id) }}
                    />
                    <span className="flex-1 truncate text-[12.5px] text-ink">{c.label}</span>
                    <span className="font-mono text-[11px] text-[var(--color-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
                      {c.size}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
            Circles are detected live from the graph structure — friends cluster
            with the interests they share.
          </p>
        </div>
      )}

      <button className="btn justify-center" onClick={onReset}>
        <RotateCcw size={13} />
        Reset view
      </button>

      <div className="panel flex items-center gap-2 px-3 py-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: mode === "api" ? "#54d26e" : "#7c96ff",
            boxShadow: `0 0 8px ${mode === "api" ? "rgba(84,210,110,0.8)" : "rgba(124,150,255,0.8)"}`,
          }}
        />
        <span className="flex-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
          {mode === "api" ? "Live API" : "Mock data"}
        </span>
        <button
          onClick={onSwitchMode}
          title={mode === "api" ? "Switch to in-browser mock" : "Switch to gateway GraphQL (:4000)"}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-faint)] transition hover:bg-[rgba(146,166,255,0.1)] hover:text-ink"
        >
          <ArrowLeftRight size={12} />
          switch
        </button>
      </div>
    </aside>
  );
}
