"use client";

/**
 * Doc context panel (agentic-ux P4): the current doc's outgoing wikilinks,
 * incoming backlinks, and a small radial "local graph" — the doc at center,
 * links/backlinks as spokes. Clicking navigates (docs open in the editor,
 * entities open the Inspector).
 */
import { useEffect, useState } from "react";
import { FileText, Link2, Orbit, CornerDownLeft } from "lucide-react";
import { useUI } from "@/lib/store";

export interface DocLink {
  targetKind: "writing" | "node";
  targetId: string;
  alias: string;
  title?: string | null;
  nodeType?: string;
  status: string;
}

export interface DocBacklink {
  writingId: string;
  title: string | null;
  alias: string;
}

export default function DocLinksPanel({ docId, refreshKey, onOpenDoc }: {
  docId: string;
  /** bump after save so links refresh */
  refreshKey: number;
  onOpenDoc: (id: string) => void;
}) {
  const select = useUI((s) => s.select);
  const [outgoing, setOutgoing] = useState<DocLink[]>([]);
  const [backlinks, setBacklinks] = useState<DocBacklink[]>([]);

  useEffect(() => {
    if (!docId || docId === "new") {
      setOutgoing([]);
      setBacklinks([]);
      return;
    }
    let alive = true;
    fetch(`/api/writings/${encodeURIComponent(docId)}/links`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setOutgoing((d as { outgoing: DocLink[] }).outgoing);
        setBacklinks((d as { backlinks: DocBacklink[] }).backlinks);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [docId, refreshKey]);

  const open = (l: DocLink) => {
    if (l.targetKind === "writing") onOpenDoc(l.targetId);
    else select(l.targetId); // Inspector host picks it up
  };

  const spokes = [
    ...outgoing.map((l) => ({ key: `o_${l.targetKind}_${l.targetId}`, label: l.title ?? l.alias, kind: l.targetKind, onClick: () => open(l) })),
    ...backlinks.map((b) => ({ key: `b_${b.writingId}`, label: b.title ?? "Untitled", kind: "back" as const, onClick: () => onOpenDoc(b.writingId) })),
  ].slice(0, 10);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scroll-quiet">
      {/* local graph */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          <Orbit size={11} /> Local graph
        </div>
        {spokes.length === 0 ? (
          <p className="text-[11px] leading-snug text-[var(--color-faint)]">
            Type <span className="text-[var(--color-accent)]">[[double brackets]]</span> around a doc
            title or entity name — connections appear here after saving.
          </p>
        ) : (
          <svg viewBox="0 0 240 200" className="w-full">
            {spokes.map((s, i) => {
              const angle = (i / spokes.length) * Math.PI * 2 - Math.PI / 2;
              const x = 120 + Math.cos(angle) * 78;
              const y = 100 + Math.sin(angle) * 66;
              const color = s.kind === "node" ? "var(--color-accent)" : s.kind === "back" ? "#7aa2ff" : "#9aa7b8";
              return (
                <g key={s.key} onClick={s.onClick} style={{ cursor: "pointer" }}>
                  <line x1={120} y1={100} x2={x} y2={y} stroke="var(--color-line)" strokeWidth={1} />
                  <circle cx={x} cy={y} r={5} fill={color} opacity={0.9} />
                  <text
                    x={x}
                    y={y + (y > 100 ? 15 : -9)}
                    textAnchor="middle"
                    fill="var(--color-dim)"
                    fontSize={8.5}
                  >
                    {s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label}
                  </text>
                </g>
              );
            })}
            <circle cx={120} cy={100} r={7} fill="var(--color-accent)" />
            <circle cx={120} cy={100} r={11} fill="none" stroke="var(--color-accent-line)" strokeWidth={1} />
          </svg>
        )}
      </div>

      {/* outgoing */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          <Link2 size={11} /> Links · {outgoing.length}
        </div>
        <ul>
          {outgoing.map((l) => (
            <li key={`${l.targetKind}_${l.targetId}`}>
              <button
                onClick={() => open(l)}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
              >
                {l.targetKind === "writing"
                  ? <FileText size={11} className="shrink-0 text-[var(--color-faint)]" />
                  : <Orbit size={11} className="shrink-0" style={{ color: "var(--color-accent)" }} />}
                <span className="min-w-0 truncate">{l.title ?? l.alias}</span>
                {l.nodeType && <span className="ml-auto shrink-0 text-[9px] uppercase text-[var(--color-faint)]">{l.nodeType}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* backlinks */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          <CornerDownLeft size={11} /> Backlinks · {backlinks.length}
        </div>
        {backlinks.length === 0 ? (
          <p className="px-2 text-[11px] text-[var(--color-faint)]">No other doc links here yet.</p>
        ) : (
          <ul>
            {backlinks.map((b) => (
              <li key={b.writingId}>
                <button
                  onClick={() => onOpenDoc(b.writingId)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                >
                  <FileText size={11} className="shrink-0 text-[var(--color-faint)]" />
                  <span className="min-w-0 truncate">{b.title ?? "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
