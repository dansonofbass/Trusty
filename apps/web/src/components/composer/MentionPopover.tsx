"use client";

import { useEffect, useMemo, useState } from "react";
import { AtSign, Hash } from "lucide-react";
import {
  NODE_TYPE_LABEL,
  TOPIC_TAXONOMY,
  type ActiveMention,
  type GNode,
  type ResolvedMention,
} from "@constellation/graph-core";
import { NODE_COLOR, NODE_GLYPH, GOLD } from "@/lib/palette";

/**
 * Mention autocomplete (#29) — @people, #topics, [[any entity]].
 *
 * Docked under the composer textarea (v1; caret-anchored positioning is a later
 * polish). Keyboard is intercepted on the window CAPTURE phase while open, so
 * arrows/Enter/Tab drive the list instead of the caret — and Enter never sends
 * the message while picking. Selection returns a resolved mention (node id or
 * canonical topic) so the agent receives ids, never guesses from text.
 */
export default function MentionPopover({
  active,
  nodes,
  onPick,
  onClose,
}: {
  active: ActiveMention;
  nodes: GNode[];
  onPick: (replacement: string, resolved: ResolvedMention) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  const candidates = useMemo(() => {
    const needle = active.query.trim().toLowerCase();
    if (active.trigger === "#") {
      return TOPIC_TAXONOMY.filter((t) => !needle || t.includes(needle) || t.replace(/_/g, " ").includes(needle))
        .slice(0, 8)
        .map((t) => ({ key: t, label: t.replace(/_/g, " "), topic: t }));
    }
    const pool = active.trigger === "@" ? nodes.filter((n) => n.type === "person" && !n.isMe) : nodes;
    return pool
      .filter((n) => !needle || n.label.toLowerCase().includes(needle) || (n.sub ?? "").toLowerCase().includes(needle))
      .slice(0, 8)
      .map((n) => ({ key: n.id, label: n.label, node: n }));
  }, [active, nodes]);

  useEffect(() => setIdx(0), [active.query, active.trigger]);

  const pick = (i: number) => {
    const c = candidates[i];
    if (!c) return;
    if ("topic" in c && c.topic) {
      onPick(c.topic, { token: `#${c.topic}`, topic: c.topic });
    } else if ("node" in c && c.node) {
      const token = active.trigger === "[[" ? `[[${c.node.label}]]` : `@${c.node.label}`;
      onPick(c.node.label, { token, id: c.node.id, type: c.node.type, label: c.node.label });
    }
  };

  // Capture-phase keys: beat the textarea's own handlers (caret moves, send-on-Enter).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.min(i + 1, Math.max(candidates.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.max(i - 1, 0));
      } else if ((e.key === "Enter" || e.key === "Tab") && candidates.length) {
        e.preventDefault();
        e.stopPropagation();
        pick(idx);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, idx, onClose]);

  if (!candidates.length) {
    return (
      <div className="mt-1 rounded-xl border border-line bg-nebula/95 px-3 py-2 text-[11px] text-[var(--color-faint)] shadow-xl">
        {active.trigger === "#" ? "No matching topic" : `Nothing matches “${active.query}”`} — keep typing or Esc.
      </div>
    );
  }

  return (
    <ul className="mt-1 overflow-hidden rounded-xl border border-line bg-nebula/95 p-1.5 shadow-xl">
      <li className="flex items-center gap-1 px-2 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
        {active.trigger === "@" ? <AtSign size={10} /> : active.trigger === "#" ? <Hash size={10} /> : "[[ ]]"}
        {active.trigger === "@" ? "people" : active.trigger === "#" ? "topics" : "entities"}
        <span className="ml-auto normal-case tracking-normal">↑↓ · Enter</span>
      </li>
      {candidates.map((c, i) => (
        <li key={c.key}>
          <button
            type="button"
            onMouseEnter={() => setIdx(i)}
            // mousedown, not click — keep the textarea focused through the pick
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition"
            style={{ background: i === idx ? "rgba(146,166,255,0.14)" : undefined }}
          >
            {"node" in c && c.node ? (
              <>
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-semibold"
                  style={{ background: `${NODE_COLOR[c.node.type]}22`, color: NODE_COLOR[c.node.type] }}
                >
                  {c.node.type === "person" ? (c.label[0] ?? "?").toUpperCase() : NODE_GLYPH[c.node.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{c.label}</span>
                  <span className="block truncate text-[10.5px] text-[var(--color-faint)]">
                    {NODE_TYPE_LABEL[c.node.type]}
                    {c.node.sub ? ` · ${c.node.sub}` : ""}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px]" style={{ background: "rgba(255,217,122,0.12)", color: GOLD }}>
                  #
                </span>
                <span className="truncate text-[12.5px] text-ink">{c.label}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
