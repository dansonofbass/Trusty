"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ear, Loader2, Radio, RefreshCw, Search, X } from "lucide-react";

/**
 * Feed — the recommendation list docked BESIDE the graph (#36 "intelligent
 * feed", Airbnb-style dual view). Two-way sync with the canvas:
 *   list → graph: filtering here lights up the matching nodes; clicking an
 *                 item flies the graph to the recommended target.
 *   graph → list: selecting a node on the canvas filters the feed to items
 *                 involving that node (clearable chip).
 * Content = recommendations from people you listen to, evidence-ranked with
 * their "why" — never trust, never popularity.
 */

interface FeedRec {
  id: string;
  author: { id?: unknown; name?: string };
  target: { id?: unknown; name?: string };
  topic?: string;
  context?: string;
  reasons?: string[];
  why?: string[];
  consensus?: { mean?: number; samples?: number };
}
interface Suggestion { id: string; name?: string; reasons: string[] }

const sid = (v: unknown): string => (typeof v === "string" ? v : "");

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
        [i.author.name, i.target.name, i.topic, i.context, ...(i.why ?? [])]
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

  return (
    <aside className="rise fixed bottom-4 left-4 top-[100px] z-30 hidden w-[336px] flex-col md:flex">
      <div className="panel flex min-h-0 flex-1 flex-col p-0">
        {/* header */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3.5 py-2.5">
          <Radio size={14} className="text-[var(--color-dim)]" />
          <span className="text-[12.5px] font-semibold text-ink">Feed</span>
          <span className="text-[10.5px] text-[var(--color-faint)]">from people you listen to</span>
          <button onClick={() => void load()} disabled={busy} aria-label="Refresh"
            className="ml-auto rounded p-1 text-[var(--color-faint)] hover:text-ink disabled:opacity-50">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </button>
          <button onClick={onClose} aria-label="Close feed"
            className="rounded p-1 text-[var(--color-faint)] hover:text-ink">
            <X size={14} />
          </button>
        </div>

        {/* filters */}
        <div className="space-y-2 border-b border-[var(--color-line)] px-3.5 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-2 py-1.5">
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
                  className="rounded-full border px-2 py-0.5 text-[10.5px]"
                  style={{
                    borderColor: topic === t ? "rgba(255,217,122,0.6)" : "var(--color-line)",
                    color: topic === t ? "#ffd97a" : "var(--color-faint)",
                  }}>
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
              <span className="rounded-full bg-[rgba(146,166,255,0.12)] px-2 py-0.5">
                showing items involving <b className="text-ink">{selected.label}</b>
              </span>
              <button onClick={onClearSelection} aria-label="Clear node filter" className="text-[var(--color-faint)] hover:text-ink"><X size={12} /></button>
            </div>
          )}
        </div>

        {/* list */}
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
          {items === null && <div className="flex items-center gap-2 py-4 text-[12px] text-[var(--color-faint)]"><Loader2 className="animate-spin" size={14} /> Loading…</div>}

          {items !== null && items.length === 0 && (
            <div className="space-y-3 py-2">
              <p className="text-[12px] leading-relaxed text-[var(--color-dim)]">
                Your feed fills up when the people you <b>listen to</b> share recommendations.
                Start with a suggestion:
              </p>
              {suggestions.slice(0, 4).map((s) => (
                <div key={s.id} className="rounded-xl border border-[var(--color-line)] p-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => onJump(s.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink hover:underline">
                      {s.name ?? s.id}
                    </button>
                    {asked[s.id] ? (
                      <span className="text-[10.5px] text-[var(--color-dim)]">{asked[s.id]}</span>
                    ) : (
                      <button onClick={() => void ask(s.id)}
                        className="flex items-center gap-1 rounded-lg border border-[rgba(63,198,244,0.4)] px-2 py-1 text-[11px] text-[#3fc6f4]">
                        <Ear size={11} /> Listen
                      </button>
                    )}
                  </div>
                  {s.reasons[0] && <div className="mt-1 text-[10.5px] text-[var(--color-faint)]">{s.reasons[0]}</div>}
                </div>
              ))}
              <Link href="/listen" className="block text-[11.5px] text-[var(--color-dim)] underline hover:text-ink">
                Manage listening →
              </Link>
            </div>
          )}

          {items !== null && items.length > 0 && filtered.length === 0 && (
            <p className="py-4 text-[12px] text-[var(--color-faint)]">Nothing matches the current filters.</p>
          )}

          <ul className="space-y-2">
            {filtered.map((r) => {
              const targetId = sid(r.target.id);
              return (
                <li key={r.id}>
                  <button
                    onClick={() => targetId && onJump(targetId)}
                    className="w-full rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-2.5 text-left transition hover:border-[rgba(146,166,255,0.4)]"
                    title="Show on the graph"
                  >
                    <div className="text-[12.5px] leading-snug text-ink">
                      <b>{r.author.name ?? "Someone"}</b> recommends <b>{r.target.name ?? "…"}</b>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {r.topic && (
                        <span className="rounded-full bg-[rgba(146,166,255,0.1)] px-1.5 py-0.5 text-[10px] text-[var(--color-dim)]">
                          {r.topic.replace(/_/g, " ")}
                        </span>
                      )}
                      {r.consensus?.samples ? (
                        <span className="text-[10px] text-[var(--color-faint)]">
                          {r.consensus.samples} outcome{r.consensus.samples === 1 ? "" : "s"}
                          {typeof r.consensus.mean === "number" && r.consensus.mean > 0 ? " · mostly positive" : ""}
                        </span>
                      ) : null}
                    </div>
                    {(r.why?.[0] ?? r.context) && (
                      <div className="mt-1 text-[11px] leading-snug text-[var(--color-faint)]">{r.why?.[0] ?? r.context}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* footer */}
        <div className="border-t border-[var(--color-line)] px-3.5 py-2">
          <Link href="/listen" className="text-[11px] text-[var(--color-faint)] hover:text-ink">
            <Ear size={11} className="mr-1 inline" /> Manage who you listen to →
          </Link>
        </div>
      </div>
    </aside>
  );
}
