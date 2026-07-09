"use client";

import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import type { GNode } from "@constellation/graph-core";
import { getHome, getWhoToMeet, type HomeSection, type MeetCard } from "@/lib/summitClient";
import type { OpenTarget } from "./SummitApp";
import { MatchPill } from "./MatchBar";
import { Search, Loader2, List as ListIcon, Waypoints } from "lucide-react";

const SevanGraph = lazy(() => import("./SevanGraph"));

const ACCENT = "#ff8c5a";

/**
 * The Trusty Sevan Home — "who should I meet next?" as a discovery feed:
 * one search bar, horizontally-scrolling match rows, and a List⇄Graph toggle
 * that mounts the same force canvas as Trusty. No empty states.
 */
export default function Home({ onOpen, savedIds }: { onOpen: (t: OpenTarget) => void; savedIds: Set<string> }) {
  const [view, setView] = useState<"list" | "graph">("list");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MeetCard[] | null>(null); // active search overrides rows
  const [sections, setSections] = useState<HomeSection[] | null>(null);

  useEffect(() => {
    getHome().then(setSections).catch(() => setSections([]));
  }, []);

  const runSearch = useCallback(async (skill: string) => {
    if (!skill) return setResults(null);
    setResults(await getWhoToMeet(skill).catch(() => []));
  }, []);

  return (
    <div className="space-y-3 pt-1">
      {/* List ⇄ Graph — the same seg-pill affordance as Trusty mobile */}
      <div className="flex rounded-full border border-line bg-space/50 p-1">
        <SegTab active={view === "list"} onClick={() => setView("list")} icon={<ListIcon size={14} />} label="List" />
        <SegTab active={view === "graph"} onClick={() => setView("graph")} icon={<Waypoints size={14} />} label="Graph" />
      </div>

      {view === "graph" ? (
        <Suspense fallback={<div className="flex h-[50dvh] items-center justify-center text-dim"><Loader2 className="animate-spin" size={18} /></div>}>
          <SevanGraph onOpen={onOpen} />
        </Suspense>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void runSearch(q.trim()); }} className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); if (!e.target.value.trim()) setResults(null); }}
              placeholder="What do you need? (e.g. engineering, funding, ai)"
              className="w-full rounded-xl border border-line bg-space/60 py-3 pl-9 pr-3 text-sm text-ink outline-none focus:border-gold/60"
            />
          </form>

          {results !== null ? (
            <ResultList results={results} savedIds={savedIds} onOpen={onOpen} />
          ) : sections === null ? (
            <div className="flex justify-center py-10 text-dim"><Loader2 className="animate-spin" size={18} /></div>
          ) : sections.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">Complete your profile to unlock your matches.</p>
          ) : (
            sections.map((s) => <Row key={s.id} section={s} savedIds={savedIds} onOpen={onOpen} />)
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ pieces ------------------------------ */

function Row({ section, savedIds, onOpen }: { section: HomeSection; savedIds: Set<string>; onOpen: (t: OpenTarget) => void }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{section.title}</div>
      <div className="scroll-quiet -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {section.items.map((it) => (
          <button
            key={it.nodeId}
            type="button"
            onClick={() => onOpen({ node: it.node, match: it.matchPct ? { pct: it.matchPct, reasons: it.reasons ?? [] } : undefined })}
            className="w-40 shrink-0 rounded-xl border border-line bg-surface/60 p-3 text-left"
          >
            <div className="flex items-start justify-between gap-1">
              <Avatar node={it.node} />
              {it.matchPct ? <MatchPill pct={it.matchPct} /> : null}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-ink">{it.node.label}</span>
              {savedIds.has(it.nodeId) && <span className="text-[9px] text-[#9af0c8]">●</span>}
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dim">
              {(it.reasons ?? []).join(" · ") || it.node.sub}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultList({ results, savedIds, onOpen }: { results: MeetCard[]; savedIds: Set<string>; onOpen: (t: OpenTarget) => void }) {
  if (results.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">No matches for that — try another skill or need.</p>;
  }
  return (
    <div className="space-y-2">
      {results.map((c) => (
        <button
          key={c.nodeId}
          type="button"
          onClick={() => onOpen({ node: c.node, match: { pct: c.matchPct, reasons: c.reasons } })}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 p-3 text-left"
        >
          <Avatar node={c.node} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink">{c.node.label}</span>
              {savedIds.has(c.nodeId) && <span className="text-[10px] text-[#9af0c8]">saved</span>}
            </div>
            <div className="truncate text-xs text-dim">{c.reasons.join(" · ")}</div>
          </div>
          <MatchPill pct={c.matchPct} />
        </button>
      ))}
    </div>
  );
}

function Avatar({ node }: { node: GNode }) {
  const isOrg = node.type === "location";
  return (
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold"
      style={isOrg ? { background: "rgba(227,200,75,0.18)", color: "#e3c84b" } : { background: "rgba(124,150,255,0.18)", color: "#a9bcff" }}
    >
      {node.label.charAt(0).toUpperCase()}
    </div>
  );
}

function SegTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition"
      style={active ? { background: "rgba(255,140,90,0.16)", color: "var(--color-ink)" } : { color: "var(--color-faint)" }}
    >
      {icon}
      {label}
    </button>
  );
}
