"use client";

import { useCallback, useEffect, useState } from "react";
import { TOPIC_TAXONOMY, reasonsForTopic } from "@constellation/graph-core";
import { TRUST_ACCENT } from "@/lib/palette";
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

/**
 * Trust Search — a docked panel (list) that drives the graph (animation +
 * highlighted trust paths) instead of a blocking modal. Natural-language query →
 * resolved scope → results grouped by hop (direct vs. through your network), each
 * with its full trust path, reasons, outcome 👍/👎, and a quick "trust this".
 */
export default function TrustSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<ResolvedScope | null>(null);
  const [recs, setRecs] = useState<TrustRec[]>([]);
  const [status, setStatus] = useState<"idle" | "resolving" | "searching" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const setTrustSearch = useUI((s) => s.setTrustSearch);
  const setTrustFocus = useUI((s) => s.setTrustFocus);

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

  const runSearch = useCallback(
    async (override?: { topic: string; geo?: string; context?: string }) => {
      setError(null);
      try {
        let s: ResolvedScope;
        if (override) {
          s = override;
          setScope(override);
        } else {
          setStatus("resolving");
          s = await resolveScope(q.trim());
          setScope(s);
        }
        if (!s.topic) {
          setRecs([]);
          setStatus("done");
          return;
        }
        setStatus("searching");
        const { recommendations } = await trustSearch({ topic: s.topic, geo: s.geo, context: s.context });
        setRecs(recommendations);
        setStatus("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [q],
  );

  const direct = recs.filter((r) => r.hops <= 1);
  const network = recs.filter((r) => r.hops > 1);

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="fixed bottom-6 left-6 z-40 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink backdrop-blur-md shadow-lg hover:border-gold/60"
        style={{ fontFamily: "var(--font-display)", borderColor: open ? "rgba(255,140,90,0.6)" : undefined }}
      >
        ✦ Trust search
      </button>

      {open && (
        // Docked, non-blocking — the graph stays visible + interactive to the right.
        <aside className="pointer-events-auto fixed bottom-4 left-4 top-20 z-40 flex w-[380px] flex-col rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              Who does your network trust?
            </h2>
            <button type="button" onClick={close} className="text-dim hover:text-ink">✕</button>
          </div>

          <div className="border-b border-line px-4 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim().length >= 2) runSearch();
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="best broker in Yerevan"
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
              />
              <button type="submit" className="rounded-lg px-3 py-2 text-sm font-semibold text-space" style={{ background: TRUST_ACCENT }}>
                Go
              </button>
            </form>

            {scope && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-faint">as</span>
                <select
                  value={scope.topic}
                  onChange={(e) => runSearch({ topic: e.target.value, geo: scope.geo, context: scope.context })}
                  className="rounded-full border border-line bg-space/60 px-2 py-1 text-ink"
                >
                  {[scope.topic, ...TOPIC_TAXONOMY.filter((t) => t !== scope.topic)].filter(Boolean).map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <input
                  value={scope.geo ?? ""}
                  onChange={(e) => setScope({ ...scope, geo: e.target.value || undefined })}
                  onBlur={() => runSearch({ topic: scope.topic, geo: scope.geo, context: scope.context })}
                  placeholder="anywhere"
                  className="w-24 rounded-full border border-line bg-space/60 px-2 py-1 text-ink"
                />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {status === "resolving" && <p className="text-sm text-dim">Understanding your request…</p>}
            {status === "searching" && <p className="text-sm text-dim">Tracing trust paths…</p>}
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
        </aside>
      )}
    </>
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
