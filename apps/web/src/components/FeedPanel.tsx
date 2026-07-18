"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check, Compass, Ear, Loader2, Radio, RefreshCw, Search, ThumbsDown, ThumbsUp, X,
} from "lucide-react";
import type { NodeType } from "@constellation/graph-core";
import { NODE_TYPE_LABEL } from "@constellation/graph-core";
import { NODE_COLOR, NODE_GLYPH, withAlpha } from "@/lib/palette";
import { markIntent } from "@/lib/outcomeClient";

/**
 * Feed — THE surface users check (#36). The graph is the map; the feed is the
 * news: what the people you listen to are recommending, as rich cards — who,
 * what (a first-class entity with its type color), their own words, how it's
 * working out for others — with one-tap reactions that become outcome evidence.
 *
 * Still the Airbnb-style dual view: filtering here lights up matching nodes,
 * card ⌖ flies the graph to the target, selecting a node on the canvas filters
 * the list. Content = recommendations from people you LISTEN to — never trust,
 * never popularity.
 */

interface FeedRec {
  id: string;
  author: { id?: unknown; name?: string };
  target: { id?: unknown; name?: string; type?: NodeType; entityType?: string; sub?: string };
  topic?: string;
  context?: string;
  reasons?: string[];
  note?: string;
  createdAt?: number;
  why?: string[];
  consensus?: { mean?: number; count?: number; contributors?: number };
}
interface Suggestion { id: string; name?: string; reasons: string[] }

const sid = (v: unknown): string => (typeof v === "string" ? v : "");

/** Compact relative time — the feed's freshness signal. */
function timeAgo(ts?: number): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}

export default function FeedPanel({
  selected,
  onJump,
  onMatch,
  onClearSelection,
  onClose,
}: {
  /** Node currently selected on the canvas (graph → list sync). */
  selected: { id: string; label: string } | null;
  /** Fly the graph to a node (list → graph sync). */
  onJump: (id: string) => void;
  /** Node ids matching the active list filters — the canvas highlights them. */
  onMatch: (ids: Set<string> | null) => void;
  onClearSelection: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FeedRec[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Record<string, string>>({});
  // Per-card reaction state: outcome 👍/👎 sent, or "I'll try this" marked.
  const [reacted, setReacted] = useState<Record<string, "up" | "down" | "intent">>({});

  const load = async () => {
    setBusy(true);
    try {
      const f = await fetch("/api/listen/feed", { cache: "no-store" }).then((r) => r.json());
      const recs: FeedRec[] = f.recommendations ?? [];
      setItems(recs);
      if (recs.length === 0) {
        const s = await fetch("/api/listen/suggestions", { cache: "no-store" }).then((r) => r.json());
        setSuggestions(s.suggestions ?? []);
      }
    } catch {
      setItems([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const topics = useMemo(
    () => [...new Set((items ?? []).map((i) => i.topic).filter((t): t is string => !!t))].slice(0, 8),
    [items],
  );

  const filtered = useMemo(() => {
    let out = items ?? [];
    if (selected) out = out.filter((i) => sid(i.target.id) === selected.id || sid(i.author.id) === selected.id);
    if (topic) out = out.filter((i) => i.topic === topic);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((i) =>
        [i.author.name, i.target.name, i.topic, i.context, i.note, ...(i.why ?? [])]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [items, selected, topic, query]);

  // list → graph: while a list filter is active, light up the matching nodes.
  useEffect(() => {
    const filterActive = !!topic || !!query.trim();
    if (!filterActive) {
      onMatch(null);
      return;
    }
    const ids = new Set<string>();
    for (const i of filtered) {
      const t = sid(i.target.id);
      const a = sid(i.author.id);
      if (t) ids.add(t);
      if (a) ids.add(a);
    }
    onMatch(ids);
    return () => onMatch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, topic, query]);

  const ask = async (personId: string) => {
    try {
      const r = await fetch("/api/listen/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: personId }),
      });
      const body = await r.json();
      setAsked((a) => ({
        ...a,
        [personId]: r.ok ? (body.status === "accepted" ? "Listening ✓" : "Requested") : "Failed",
      }));
      if (r.ok && body.status === "accepted") await load();
    } catch { /* best-effort */ }
  };

  /** 👍/👎 → outcome evidence on the recommendation (reputation + author contribution). */
  const judge = async (rec: FeedRec, value: 1 | -1) => {
    setReacted((p) => ({ ...p, [rec.id]: value > 0 ? "up" : "down" }));
    try {
      await fetch(`/api/recs/${encodeURIComponent(rec.id)}/outcomes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch { /* best-effort */ }
  };

  /** "I'll try this" → intent, so the outcome prompt follows up later. */
  const tryThis = async (rec: FeedRec) => {
    const targetId = sid(rec.target.id);
    if (!targetId) return;
    setReacted((p) => ({ ...p, [rec.id]: "intent" }));
    try {
      await markIntent({ nodeId: targetId, topic: rec.topic });
    } catch { /* best-effort */ }
  };

  return (
    <aside className="rise fixed bottom-4 left-4 top-[100px] z-30 hidden w-[360px] flex-col md:flex">
      <div className="panel flex min-h-0 flex-1 flex-col p-0">
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-[var(--color-line)] px-4 py-3">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          >
            <Radio size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              Feed
            </div>
            <div className="truncate text-[10.5px] text-[var(--color-faint)]">
              what the people you listen to recommend
            </div>
          </div>
          <button onClick={() => void load()} disabled={busy} aria-label="Refresh"
            className="rounded p-1 text-[var(--color-faint)] hover:text-ink disabled:opacity-50">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </button>
          <button onClick={onClose} aria-label="Close feed"
            className="rounded p-1 text-[var(--color-faint)] hover:text-ink">
            <X size={14} />
          </button>
        </div>

        {/* filters */}
        <div className="space-y-2 border-b border-[var(--color-line)] px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-tint-soft)] px-2 py-1.5">
            <Search size={12} className="shrink-0 text-[var(--color-faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter — also lights up the graph"
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-[var(--color-faint)]"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear" className="text-[var(--color-faint)] hover:text-ink"><X size={12} /></button>
            )}
          </div>
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {topics.map((t) => (
                <button key={t} onClick={() => setTopic(topic === t ? null : t)}
                  className="rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition"
                  style={
                    topic === t
                      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                      : { borderColor: "var(--color-line)", color: "var(--color-faint)" }
                  }>
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
              <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5">
                showing items involving <b className="text-ink">{selected.label}</b>
              </span>
              <button onClick={onClearSelection} aria-label="Clear node filter" className="text-[var(--color-faint)] hover:text-ink"><X size={12} /></button>
            </div>
          )}
        </div>

        {/* list */}
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {items === null && <div className="flex items-center gap-2 px-1 py-4 text-[12px] text-[var(--color-faint)]"><Loader2 className="animate-spin" size={14} /> Loading…</div>}

          {items !== null && items.length === 0 && (
            <div className="space-y-3 px-1 py-2">
              <p className="text-[12px] leading-relaxed text-[var(--color-dim)]">
                Your feed fills up when the people you <b>listen to</b> share recommendations.
                Start with a suggestion:
              </p>
              {suggestions.slice(0, 4).map((s) => (
                <div key={s.id} className="card p-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                      style={{ background: withAlpha(NODE_COLOR.person, 0.16), color: NODE_COLOR.person }}
                    >
                      {(s.name ?? "?")[0]?.toUpperCase()}
                    </span>
                    <button onClick={() => onJump(s.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink hover:underline">
                      {s.name ?? s.id}
                    </button>
                    {asked[s.id] ? (
                      <span className="text-[10.5px] text-[var(--color-dim)]">{asked[s.id]}</span>
                    ) : (
                      <button onClick={() => void ask(s.id)}
                        className="flex items-center gap-1 rounded-lg border border-[rgba(63,198,244,0.4)] px-2 py-1 text-[11px] text-[var(--color-info)]">
                        <Ear size={11} /> Listen
                      </button>
                    )}
                  </div>
                  {s.reasons[0] && <div className="mt-1 pl-9 text-[10.5px] text-[var(--color-faint)]">{s.reasons[0]}</div>}
                </div>
              ))}
              <Link href="/listen" className="block text-[11.5px] text-[var(--color-dim)] underline hover:text-ink">
                Manage listening →
              </Link>
            </div>
          )}

          {items !== null && items.length > 0 && filtered.length === 0 && (
            <p className="px-1 py-4 text-[12px] text-[var(--color-faint)]">Nothing matches the current filters.</p>
          )}

          <ul className="space-y-2.5">
            {filtered.map((r) => {
              const targetId = sid(r.target.id);
              const tType = (r.target.type ?? "location") as NodeType;
              const tColor = NODE_COLOR[tType] ?? NODE_COLOR.location;
              const ago = timeAgo(r.createdAt);
              const reaction = reacted[r.id];
              const outcomes = r.consensus?.count ?? 0;
              const positive = outcomes > 0 && typeof r.consensus?.mean === "number" && r.consensus.mean > 0;
              return (
                <li key={r.id} className="card overflow-hidden p-0">
                  {/* who + when */}
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold"
                      style={{ background: withAlpha(NODE_COLOR.person, 0.16), color: NODE_COLOR.person }}
                    >
                      {(r.author.name ?? "?")[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-dim)]">
                      <b className="text-ink">{r.author.name ?? "Someone"}</b> recommends
                    </span>
                    {ago && (
                      <span className="shrink-0 text-[10px] text-[var(--color-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
                        {ago}
                      </span>
                    )}
                  </div>

                  {/* the target — the star of the card */}
                  <button
                    onClick={() => targetId && onJump(targetId)}
                    title="Show on the graph"
                    className="group mt-2 flex w-full items-center gap-2.5 px-3 text-left"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[15px] font-semibold"
                      style={{ background: withAlpha(tColor, 0.14), border: `1px solid ${withAlpha(tColor, 0.4)}`, color: tColor }}
                    >
                      {tType === "person" ? (r.target.name ?? "?")[0]?.toUpperCase() : NODE_GLYPH[tType] ?? "◉"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold leading-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
                        {r.target.name ?? "…"}
                      </span>
                      <span className="block truncate text-[10.5px] text-[var(--color-faint)]">
                        {r.target.sub ?? NODE_TYPE_LABEL[tType] ?? ""}
                      </span>
                    </span>
                    <Compass size={14} className="shrink-0 text-[var(--color-faint)] opacity-0 transition group-hover:opacity-100" />
                  </button>

                  {/* the author's words */}
                  {(r.note ?? r.context) && (
                    <p className="mt-2 border-l-2 px-3 text-[11.5px] italic leading-snug text-[var(--color-dim)]"
                      style={{ borderColor: "var(--color-accent-line)", marginLeft: "12px", paddingLeft: "8px", marginRight: "12px" }}>
                      “{r.note ?? r.context}”
                    </p>
                  )}

                  {/* topic + reasons + consensus */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3">
                    {r.topic && (
                      <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                        style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                        {r.topic.replace(/_/g, " ")}
                      </span>
                    )}
                    {(r.reasons ?? []).slice(0, 3).map((rc) => (
                      <span key={rc} className="rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[9.5px] text-[var(--color-faint)]">
                        {rc.replace(/_/g, " ")}
                      </span>
                    ))}
                    {outcomes > 0 && (
                      <span className="ml-auto flex items-center gap-1 text-[10px]"
                        style={{ color: positive ? "#54d26e" : "var(--color-faint)" }}>
                        <ThumbsUp size={10} /> {outcomes} outcome{outcomes === 1 ? "" : "s"}
                        {positive ? " · mostly positive" : ""}
                      </span>
                    )}
                  </div>

                  {/* reactions — one tap becomes outcome evidence */}
                  <div className="mt-2.5 flex items-center border-t border-[var(--color-line)] bg-[var(--color-tint-soft)]">
                    {reaction === "intent" ? (
                      <span className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-semibold" style={{ color: "var(--color-accent)" }}>
                        <Check size={12} /> We&apos;ll check back with you
                      </span>
                    ) : reaction ? (
                      <span className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] text-[var(--color-faint)]">
                        Noted {reaction === "up" ? "👍" : "👎"} — thanks, this feeds reputation
                      </span>
                    ) : (
                      <>
                        <button onClick={() => void tryThis(r)}
                          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-semibold transition hover:bg-[var(--color-accent-soft)]"
                          style={{ color: "var(--color-accent)" }}
                          title="We'll follow up to ask how it went">
                          I&apos;ll try this
                        </button>
                        <span className="h-5 w-px bg-[var(--color-line)]" />
                        <button onClick={() => void judge(r, 1)} aria-label="Worked for me"
                          className="flex items-center justify-center px-4 py-2 text-[var(--color-dim)] transition hover:text-[#54d26e]"
                          title="I used this — it worked out">
                          <ThumbsUp size={13} />
                        </button>
                        <button onClick={() => void judge(r, -1)} aria-label="Didn't work for me"
                          className="flex items-center justify-center px-4 py-2 text-[var(--color-dim)] transition hover:text-[var(--color-danger)]"
                          title="I used this — it didn't work out">
                          <ThumbsDown size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* footer */}
        <div className="border-t border-[var(--color-line)] px-4 py-2">
          <Link href="/listen" className="text-[11px] text-[var(--color-faint)] hover:text-ink">
            <Ear size={11} className="mr-1 inline" /> Manage who you listen to →
          </Link>
        </div>
      </div>
    </aside>
  );
}
