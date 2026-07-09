"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Search, Sparkles, X } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { NODE_TYPE_LABEL } from "@constellation/graph-core";
import { GOLD, NODE_COLOR, NODE_GLYPH, withAlpha } from "@/lib/palette";

/**
 * First-run onboarding. A new user starts with an empty sky (just their own
 * star) and builds their constellation deliberately — by searching, picking
 * SEVERAL people/ideas, and submitting once (no mutation on each tap). A few
 * well-connected nodes are surfaced so the empty box isn't intimidating.
 */
export default function Onboarding({
  name,
  allNodes,
  meId,
  connectedIds,
  suggestions,
  pending,
  onSubmit,
  onInspect,
  onDismiss,
}: {
  name: string;
  allNodes: GNode[];
  meId: string;
  connectedIds: Set<string>;
  suggestions: GNode[];
  pending: boolean;
  onSubmit: (ids: string[]) => void;
  onInspect: (id: string) => void;
  onDismiss: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suggestions;
    return allNodes
      .filter(
        (n) =>
          n.id !== meId &&
          !n.isMe &&
          !connectedIds.has(n.id) &&
          (n.label.toLowerCase().includes(needle) || (n.sub ?? "").toLowerCase().includes(needle)),
      )
      .slice(0, 10);
  }, [q, allNodes, meId, connectedIds, suggestions]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="panel rise pointer-events-auto flex max-h-[80vh] w-full max-w-lg flex-col p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-[16px]"
              style={{ background: withAlpha(GOLD, 0.16), color: GOLD }}
            >
              ✦
            </span>
            <div>
              <div className="text-[14px] font-semibold text-ink">Welcome, {name}</div>
              <p className="text-[11.5px] text-[var(--color-dim)]">
                Your sky is empty. Pick a few people and ideas, then add them all at once.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss onboarding"
            className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)]"
            onClick={onDismiss}
          >
            <X size={15} />
          </button>
        </div>

        {/* live search */}
        <div className="relative mb-3">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
          />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, books, ideas…"
            className="w-full rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] py-2.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(146,166,255,0.4)]"
          />
        </div>

        <div className="eyebrow mb-2 flex items-center gap-1.5">
          {q.trim() ? (
            <>
              <Search size={11} /> Results · {results.length}
            </>
          ) : (
            <>
              <Sparkles size={11} style={{ color: GOLD }} /> Suggested to start with
            </>
          )}
        </div>

        {/* results / suggestions — multi-select */}
        <ul className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1 scroll-quiet">
          {results.map((n) => {
            const on = selected.has(n.id);
            return (
              <li key={n.id}>
                <div
                  className={`flex items-center gap-2.5 rounded-xl border p-2 transition ${
                    on
                      ? "border-[rgba(255,217,122,0.45)] bg-[rgba(255,217,122,0.08)]"
                      : "border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] hover:border-[rgba(146,166,255,0.3)]"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    onClick={() => toggle(n.id)}
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
                      style={{ background: withAlpha(NODE_COLOR[n.type], 0.16), color: NODE_COLOR[n.type] }}
                    >
                      {n.type === "person" ? (n.label[0] ?? "?").toUpperCase() : NODE_GLYPH[n.type]}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{n.label}</span>
                      <span className="block truncate text-[10.5px] text-[var(--color-faint)]">
                        {NODE_TYPE_LABEL[n.type]}
                        {n.sub ? ` · ${n.sub}` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="text-[10.5px] text-[var(--color-faint)] underline hover:text-ink"
                    onClick={() => onInspect(n.id)}
                  >
                    view
                  </button>
                  <button
                    type="button"
                    aria-label={on ? "Deselect" : "Select"}
                    onClick={() => toggle(n.id)}
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                      on
                        ? "border-transparent text-[#0b0e1c]"
                        : "border-[var(--color-line)] text-transparent"
                    }`}
                    style={on ? { background: GOLD } : undefined}
                  >
                    <Check size={13} />
                  </button>
                </div>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="py-6 text-center text-[12px] text-[var(--color-faint)]">
              Nothing matches “{q}”. Try another name.
            </li>
          )}
        </ul>

        {/* submit */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
          <button type="button" className="text-[11px] text-[var(--color-faint)] underline hover:text-ink" onClick={onDismiss}>
            I&apos;ll explore on my own
          </button>
          <button
            type="button"
            className="btn btn-gold"
            disabled={pending || selected.size === 0}
            onClick={() => onSubmit([...selected])}
          >
            <Sparkles size={13} />
            Add {selected.size || ""} to my sky
          </button>
        </div>
      </div>
    </div>
  );
}
