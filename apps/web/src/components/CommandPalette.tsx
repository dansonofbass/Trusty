"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { NODE_TYPE_LABEL } from "@constellation/graph-core";
import { NODE_COLOR, NODE_GLYPH } from "@/lib/palette";

/**
 * Command-palette search — a centered overlay (⌘K / "/") with a full-size input
 * and keyboard-navigable results. Replaces the cramped inline top-bar search.
 */
export default function CommandPalette({
  allNodes,
  onJump,
  onClose,
}: {
  allNodes: GNode[];
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return allNodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(needle) ||
          (n.sub ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [q, allNodes]);

  const jump = (id: string) => {
    onJump(id);
    onClose();
  };

  return (
    // `pointer-events-auto` is required: this renders inside the TopBar header,
    // which is `pointer-events-none` (so it doesn't block the canvas). Without
    // re-enabling it here, the palette is visible but every click falls THROUGH
    // to the force-graph canvas below.
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="fixed inset-0 bg-[rgba(4,6,16,0.62)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="panel rise relative z-10 w-full max-w-xl overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-[var(--color-line)] px-4 py-3">
          <Search size={17} className="shrink-0 text-[var(--color-faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                const r = results[activeIdx] ?? results[0];
                if (r) jump(r.id);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search people, books, ideas, places…"
            className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          <kbd className="shrink-0 rounded bg-[rgba(146,166,255,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--color-faint)]">
            esc
          </kbd>
        </div>

        {results.length > 0 ? (
          <ul className="max-h-[52vh] overflow-auto p-2 scroll-quiet">
            {results.map((n, i) => (
              <li key={n.id}>
                <button
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => jump(n.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition"
                  style={{ background: i === activeIdx ? "rgba(146,166,255,0.14)" : undefined }}
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
                    style={{ background: `${NODE_COLOR[n.type]}22`, color: NODE_COLOR[n.type] }}
                  >
                    {n.type === "person" ? (n.label[0] ?? "?").toUpperCase() : NODE_GLYPH[n.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{n.label}</span>
                    <span className="block truncate text-[11px] text-[var(--color-faint)]">
                      {NODE_TYPE_LABEL[n.type]}
                      {n.sub ? ` · ${n.sub}` : ""}
                    </span>
                  </span>
                  {i === activeIdx && (
                    <span
                      className="shrink-0 text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      ↵ jump
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-10 text-center text-[12.5px] text-[var(--color-faint)]">
            {q.trim() ? (
              <>Nothing matches “{q}”.</>
            ) : (
              <>Search your whole universe — people, books, ideas, places, signals.</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
