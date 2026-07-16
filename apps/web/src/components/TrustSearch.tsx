"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, Target, Network, X as XIcon } from "lucide-react";
import { NODE_TYPE_LABEL, TOPIC_TAXONOMY, reasonsForTopic, type GNode } from "@constellation/graph-core";
import { NODE_COLOR, NODE_GLYPH, TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { useUI } from "@/lib/store";
import {
  addTrust,
  recordOutcome,
  resolveScope,
  trustSearch,
  type ResolvedScope,
  type TrustRec,
} from "@/lib/trustClient";
import { markIntent } from "@/lib/outcomeClient";
import { createAsk } from "@/lib/asksClient";
import { streamConciergeAnswer } from "@/lib/conciergeClient";
import { AgentTrace, MarkdownLite, type ThinkStep } from "@/components/concierge/AgentTrace";

/**
 * Unified search — one top-navbar overlay (⌘K / Ctrl+K / click) that covers both
 * worlds: instant "Jump to" entity matches over the loaded graph, and the trust
 * search (natural-language query → resolved scope → results grouped by hop, each
 * with its full trust path, reasons, outcome 👍/👎, and a quick "trust this")
 * whose results drive the graph overlay instead of a blocking modal.
 */
const baseSteps = (): ThinkStep[] => [
  { id: "intent", label: "Understanding your request", status: "active", icon: <Target size={13} /> },
  { id: "search", label: "Tracing trust paths", status: "pending", icon: <Network size={13} /> },
  { id: "answer", label: "Reading your graph & answering", status: "pending", icon: <Sparkles size={13} /> },
];

export default function TrustSearch({
  allNodes,
  onJump,
}: {
  allNodes: GNode[];
  onJump: (id: string) => void;
}) {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<ResolvedScope | null>(null);
  const [recs, setRecs] = useState<TrustRec[]>([]);
  const [status, setStatus] = useState<"idle" | "resolving" | "searching" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ThinkStep[] | null>(null);
  const [answer, setAnswer] = useState("");
  const [answerDone, setAnswerDone] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [ranQ, setRanQ] = useState<string | null>(null); // query the trust search last ran with
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setTrustSearch = useUI((s) => s.setTrustSearch);
  const setTrustFocus = useUI((s) => s.setTrustFocus);
  const setStep = (id: string, patch: Partial<ThinkStep>) =>
    setSteps((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Instant "Jump to" matches over the loaded graph — the old command palette.
  const entityMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return allNodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(needle) ||
          (n.sub ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [q, allNodes]);
  // Keyboard rows: entity matches first, then the synthetic "ask your network" row.
  const askable = q.trim().length >= 2;
  const rowCount = entityMatches.length + (askable ? 1 : 0);

  // Publish/clear the graph overlay as results change or the panel closes.
  useEffect(() => {
    if (open && scope?.topic && status === "done") {
      setTrustSearch({ topic: scope.topic, geo: scope.geo, recs });
    }
  }, [open, scope, recs, status, setTrustSearch]);

  const close = () => {
    setOpen(false);
    setTrustSearch(null);
    setTrustFocus(null);
  };

  const jump = (id: string) => {
    onJump(id);
    close();
  };

  /** Run search + concierge answer for a resolved scope. */
  const runWithScope = useCallback(
    async (s: ResolvedScope, queryText: string) => {
      setStatus("searching");
      setStep("search", { status: "active" });
      const { recommendations } = await trustSearch({ topic: s.topic, geo: s.geo, context: s.context });
      setRecs(recommendations);
      setStep("search", {
        status: "done",
        summary: `${recommendations.length} trusted ${recommendations.length === 1 ? "path" : "paths"}`,
        detail: recommendations.length ? (
          <div className="space-y-1">
            {recommendations.slice(0, 8).map((r) => (
              <button key={r.nodeId} type="button" onMouseEnter={() => setTrustFocus(r.nodeId)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/[0.05]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                  style={{ background: withAlpha(TRUST_ACCENT, 0.18), color: TRUST_ACCENT }}>
                  {r.label.charAt(0).toUpperCase()}
                </span>
                <span className="truncate text-[12px] text-ink">{r.label}</span>
                <span className="ml-auto shrink-0 text-[10px] text-faint">{Math.round(Math.min(1, r.score) * 100)}% · {r.hops === 1 ? "direct" : `${r.hops} hops`}</span>
              </button>
            ))}
          </div>
        ) : undefined,
      });
      setStatus("done");

      setStep("answer", { status: "active" });
      if (recommendations.length === 0) {
        setStep("answer", { status: "done" });
        setAnswerDone(true);
        return;
      }
      try {
        await streamConciergeAnswer(
          queryText || s.topic,
          recommendations.slice(0, 8).map((r) => ({
            label: r.label, entityType: r.nodeType, sub: r.sub,
            matchPct: Math.round(Math.min(1, r.score) * 100), reasons: r.reasons,
          })),
          (t) => setAnswer((a) => a + t),
          undefined,
          "trust",
        );
      } catch { /* answer is best-effort; trust paths still show */ }
      setStep("answer", { status: "done" });
      setAnswerDone(true);
    },
    [setTrustFocus],
  );

  const runSearch = useCallback(async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setRanQ(query);
    setError(null);
    setSteps(baseSteps());
    setAnswer("");
    setAnswerDone(false);
    try {
      setStatus("resolving");
      const s = await resolveScope(query);
      setScope(s);
      if (!s.topic) {
        setStep("intent", { status: "done", summary: "couldn't pin a topic" });
        setStep("search", { status: "done", summary: "—" });
        setStep("answer", { status: "done" });
        setRecs([]);
        setStatus("done");
        setAnswerDone(true);
        return;
      }
      setStep("intent", {
        status: "done",
        summary: `${s.topic.replace(/_/g, " ")}${s.geo ? ` · ${s.geo}` : ""}`,
        detail: <ScopeChips scope={s} />,
      });
      await runWithScope(s, query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      setAnswerDone(true);
      setSteps((prev) => (prev ? prev.map((st) => (st.status === "active" || st.status === "pending" ? { ...st, status: "error" } : st)) : prev));
    }
  }, [q, runWithScope]);

  // Change topic/geo without re-resolving — reruns search + answer.
  const rerun = useCallback(async (next: ResolvedScope) => {
    setScope(next);
    setError(null);
    setSteps(baseSteps().map((s) => (s.id === "intent"
      ? { ...s, status: "done", summary: `${next.topic.replace(/_/g, " ")}${next.geo ? ` · ${next.geo}` : ""}`, detail: <ScopeChips scope={next} /> }
      : s)));
    setAnswer("");
    setAnswerDone(false);
    try { await runWithScope(next, q.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus("error"); setAnswerDone(true); }
  }, [q, runWithScope]);

  const direct = recs.filter((r) => r.hops <= 1);
  const network = recs.filter((r) => r.hops > 1);
  const hasPanel = open && (steps !== null || recs.length > 0);

  if (!open) return null;

  return (
    <>
      {/* Transparent click-catcher — no blur, the graph must stay visible while
          trust results animate the orange overlay behind the panel. */}
      <div className="fixed inset-0 z-40" onClick={close} aria-hidden />

      {/* Unified search — takes the navbar band (⌘K / click), not "a bit lower". */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(); }}
          className="pointer-events-auto w-full max-w-[640px]"
        >
          <div
            className="flex items-center gap-2 rounded-2xl border bg-nebula/95 px-3 shadow-xl backdrop-blur-md transition-colors"
            style={{ borderColor: withAlpha(TRUST_ACCENT, 0.6) }}
          >
            <Search size={16} style={{ color: TRUST_ACCENT }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  const n = entityMatches[activeIdx];
                  if (n) {
                    e.preventDefault();
                    jump(n.id);
                  } // else: fall through to the form submit → trust search
                } else if (e.key === "Escape") {
                  close();
                }
              }}
              placeholder="Search your universe, or ask — “best immigration lawyer in Yerevan”"
              className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-faint hover:text-ink"><XIcon size={14} /></button>
            )}
            <button
              type="submit"
              disabled={q.trim().length < 2}
              className="shrink-0 rounded-xl px-3.5 py-1.5 text-[12px] font-bold text-space disabled:opacity-40"
              style={{ background: TRUST_ACCENT }}
            >
              Search
            </button>
            <kbd className="hidden shrink-0 rounded bg-[rgba(146,166,255,0.12)] px-1.5 py-0.5 text-[10px] text-faint sm:inline">esc</kbd>
          </div>

          {/* Instant results: jump to a node, or hand the query to the trust search.
              Yields to the trust panel once a search ran for this exact query. */}
          {q.trim() && q.trim() !== ranQ && (
            <div className="pointer-events-auto mt-2 overflow-hidden rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
              {entityMatches.length > 0 && (
                <ul className="p-2">
                  <li className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">Jump to</li>
                  {entityMatches.map((n, i) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => jump(n.id)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition"
                        style={{ background: i === activeIdx ? "rgba(146,166,255,0.14)" : undefined }}
                      >
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
                          style={{ background: `${NODE_COLOR[n.type]}22`, color: NODE_COLOR[n.type] }}
                        >
                          {n.type === "person" ? (n.label[0] ?? "?").toUpperCase() : NODE_GLYPH[n.type]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{n.label}</span>
                          <span className="block truncate text-[11px] text-faint">
                            {NODE_TYPE_LABEL[n.type]}
                            {n.sub ? ` · ${n.sub}` : ""}
                          </span>
                        </span>
                        {i === activeIdx && (
                          <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-faint" style={{ fontFamily: "var(--font-mono)" }}>
                            ↵ jump
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {askable && (
                <button
                  type="submit"
                  onMouseEnter={() => setActiveIdx(entityMatches.length)}
                  className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left transition"
                  style={{ background: activeIdx === entityMatches.length ? withAlpha(TRUST_ACCENT, 0.12) : undefined }}
                >
                  <Sparkles size={15} style={{ color: TRUST_ACCENT }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    Ask your network for “{q.trim()}”
                  </span>
                  <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-faint" style={{ fontFamily: "var(--font-mono)" }}>
                    ↵ trust search
                  </span>
                </button>
              )}
            </div>
          )}

          {hasPanel && (
            <div className="pointer-events-auto mt-2 max-h-[72vh] overflow-auto rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md scroll-quiet">
              {/* Scope override */}
              {scope?.topic && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
                  <span className="text-faint">reading as</span>
                  <select
                    value={scope.topic}
                    onChange={(e) => rerun({ ...scope, topic: e.target.value })}
                    className="rounded-full border border-line bg-space/60 px-2 py-1 text-ink"
                  >
                    {[scope.topic, ...TOPIC_TAXONOMY.filter((t) => t !== scope.topic)].filter(Boolean).map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                  <input
                    defaultValue={scope.geo ?? ""}
                    onBlur={(e) => { const geo = e.target.value || undefined; if (geo !== scope.geo) rerun({ ...scope, geo }); }}
                    placeholder="anywhere"
                    className="w-28 rounded-full border border-line bg-space/60 px-2 py-1 text-ink"
                  />
                  <button type="button" onClick={close} className="ml-auto text-faint hover:text-ink"><XIcon size={14} /></button>
                </div>
              )}

              {/* Concierge trace */}
              {steps && (
                <div className="border-b border-line px-3 py-2.5">
                  <span className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TRUST_ACCENT }}>
                    <Sparkles size={12} /> Trust concierge
                  </span>
                  <AgentTrace steps={steps} accent={TRUST_ACCENT} />
                  {(answer || !answerDone) && (
                    <div className="mt-2 border-t border-line/60 px-1 pt-2 text-[13px] leading-relaxed text-ink">
                      <MarkdownLite text={answer} />
                      {!answerDone && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse align-middle" style={{ background: TRUST_ACCENT }} />}
                    </div>
                  )}
                </div>
              )}

              <div className="px-4 py-3">
                {error && <p className="text-sm text-rose-300">{error}</p>}

                {status === "done" && recs.length === 0 && scope?.topic && (
                  <div className="rounded-lg border border-line bg-space/40 p-4 text-sm text-dim">
                    No trusted path to a <b className="text-ink">{scope.topic.replace(/_/g, " ")}</b>
                    {scope.geo ? ` in ${scope.geo}` : ""} yet. Don&apos;t stop here — ask your network, and a
                    friend&apos;s answer becomes a recommendation you can trust.
                    <AskCTA topic={scope.topic} geo={scope.geo} />
                  </div>
                )}

                {direct.length > 0 && (
                  <Group title="You trust directly">
                    {direct.map((r) => (
                      <TrustResult key={r.nodeId} rec={r} topic={scope?.topic ?? ""} geo={scope?.geo}
                        onHover={() => setTrustFocus(r.nodeId)} />
                    ))}
                  </Group>
                )}
                {network.length > 0 && (
                  <Group title="Trusted through your network">
                    {network.map((r) => (
                      <TrustResult key={r.nodeId} rec={r} topic={scope?.topic ?? ""} geo={scope?.geo}
                        onHover={() => setTrustFocus(r.nodeId)} />
                    ))}
                  </Group>
                )}
              </div>
            </div>
          )}
        </form>
      </div>
    </>
  );
}

/** The resolved scope shown as chips inside the intent step. */
function ScopeChips({ scope }: { scope: ResolvedScope }) {
  const chips = [
    { k: "topic", v: scope.topic.replace(/_/g, " ") },
    ...(scope.geo ? [{ k: "where", v: scope.geo }] : []),
    ...(scope.context ? [{ k: "context", v: scope.context }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c.k} className="rounded-md border px-2 py-0.5 text-[11px] capitalize"
          style={{ borderColor: withAlpha(TRUST_ACCENT, 0.3), background: withAlpha(TRUST_ACCENT, 0.1), color: TRUST_ACCENT }}>
          <span style={{ opacity: 0.7 }}>{c.k}:</span> {c.v}
        </span>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Cold-start rescue: broadcast the failed search to your network. */
function AskCTA({ topic, geo }: { topic: string; geo?: string }) {
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    try {
      await createAsk({ topic, geo });
      setAsked(true);
    } catch {
      /* ignore */
    } finally {
      setAsking(false);
    }
  };
  if (asked)
    return (
      <div className="mt-3 text-xs font-semibold" style={{ color: TRUST_ACCENT }}>
        ✓ Asked your network — answers will appear here.
      </div>
    );
  return (
    <button
      type="button"
      onClick={ask}
      disabled={asking}
      className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-space disabled:opacity-60"
      style={{ background: TRUST_ACCENT }}
    >
      📣 {asking ? "Asking…" : "Ask your network"}
    </button>
  );
}

function TrustResult({
  rec,
  topic,
  geo,
  onHover,
}: {
  rec: TrustRec;
  topic: string;
  geo?: string;
  onHover: () => void;
}) {
  const [outcome, setOutcome] = useState<"none" | "up" | "down">("none");
  const [trusting, setTrusting] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [intended, setIntended] = useState(false);
  const [confidence, setConfidence] = useState(0.8);
  const [picked, setPicked] = useState<string[]>([]);
  const lastHop = rec.trustPath?.[rec.trustPath.length - 1];
  const pct = Math.round(Math.min(1, rec.score) * 100);

  async function useThis() {
    setIntended(true);
    try {
      await markIntent({ nodeId: rec.nodeId, edgeId: lastHop?.edgeId, topic, geo });
    } catch {
      setIntended(false);
    }
  }

  async function judge(value: number) {
    if (!lastHop) return;
    setOutcome(value >= 0 ? "up" : "down");
    try {
      await recordOutcome(lastHop.edgeId, value, rec.nodeId);
    } catch {
      /* best-effort */
    }
  }

  async function saveTrust() {
    try {
      await addTrust({ to: rec.nodeId, scope: { topic, geo }, reasons: picked, confidence });
      setTrusted(true);
      setTrusting(false);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="rounded-xl border border-line bg-space/40 p-3 transition hover:border-[rgba(255,140,90,0.5)]"
      onMouseEnter={onHover}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-ink">{rec.label}</div>
        <div className="text-xs text-faint">{rec.nodeType}</div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TRUST_ACCENT }} />
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-faint">
        Trust {pct}% · {rec.hops === 1 ? "direct" : `${rec.hops} hops`}
      </div>

      {/* Context: the trust path (Doc §8–9) */}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
        {rec.pathLabels.map((name, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-faint">→</span>}
            <span className={i === rec.pathLabels.length - 1 ? "font-medium text-ink" : "text-dim"}>{name}</span>
          </span>
        ))}
      </div>
      {rec.reasons.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rec.reasons.map((rc) => (
            <span key={rc} className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-dim">
              {rc.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {intended ? (
          <span className="text-xs" style={{ color: TRUST_ACCENT }}>✓ We&apos;ll check back with you</span>
        ) : (
          <button
            type="button"
            onClick={useThis}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-space"
            style={{ background: TRUST_ACCENT }}
            title="We'll follow up to ask how it went"
          >
            I&apos;ll use this
          </button>
        )}
        <span className="text-line">·</span>
        {outcome === "none" ? (
          <>
            <span className="text-xs text-faint">Used it?</span>
            <button type="button" onClick={() => judge(1)} className="rounded-full border border-line px-2 py-0.5 text-sm hover:border-gold/60">👍</button>
            <button type="button" onClick={() => judge(-1)} className="rounded-full border border-line px-2 py-0.5 text-sm hover:border-gold/60">👎</button>
          </>
        ) : (
          <span className="text-xs text-faint">Noted {outcome === "up" ? "👍" : "👎"}</span>
        )}
        <span className="text-line">·</span>
        {trusted ? (
          <span className="text-xs" style={{ color: TRUST_ACCENT }}>You trust them ✓</span>
        ) : !trusting ? (
          <button type="button" onClick={() => setTrusting(true)} className="text-xs text-dim hover:text-ink">+ I trust them</button>
        ) : null}
      </div>

      {trusting && !trusted && (
        <div className="mt-2 rounded-lg border border-line bg-nebula/60 p-2">
          <div className="mb-1.5 flex flex-wrap gap-1">
            {reasonsForTopic(topic).slice(0, 8).map((rc) => (
              <button
                key={rc}
                type="button"
                onClick={() => setPicked((p) => (p.includes(rc) ? p.filter((x) => x !== rc) : [...p, rc]))}
                className="rounded-full border px-1.5 py-0.5 text-[10px]"
                style={{
                  borderColor: picked.includes(rc) ? "rgba(255,140,90,0.6)" : "var(--color-line)",
                  color: picked.includes(rc) ? "var(--color-ink)" : "var(--color-faint)",
                }}
              >
                {rc.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="range" min={0.1} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="flex-1" />
            <span className="w-8 text-right text-xs text-ink">{confidence.toFixed(2)}</span>
            <button type="button" onClick={saveTrust} className="rounded px-2 py-1 text-xs font-semibold text-space" style={{ background: TRUST_ACCENT }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
