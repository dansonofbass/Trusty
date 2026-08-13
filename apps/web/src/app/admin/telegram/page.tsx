"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Telegram connector admin — sources, ingestion, and the review queue.
 *
 * The queue is the centre of this page, not the sources list: mined knowledge
 * about visas and fees must be read by a person before it reaches members, so
 * approving is the primary action and everything else is setup.
 */

interface Source {
  id: string; title: string; chatId: string | null; app: string;
  defaultCircle: string; kind: string; lang: string; enabled: boolean;
}
interface Candidate {
  key: string; sourceId: string; kind: string; confidence: number; stage: string;
  status: string; evidence: number[]; createdAt: string;
  payload: Record<string, unknown>;
}
interface Run {
  id: string; sourceId: string; finishedAt: string; seen: number; inserted: number;
  byClass: Record<string, number>; candidates: Record<string, number>; warnings: string[];
}
interface EvidenceMsg { id: number; date: string; from: string; text: string; cls: string }

const card = "rounded-2xl border border-line bg-surface backdrop-blur-md p-6";
const label = "block text-[11px] font-semibold uppercase tracking-[0.18em] text-dim mb-2";
const input = "w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-ink outline-none focus:border-gold/60";
const btn = "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition disabled:opacity-40";

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api/admin/telegram/${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
};

export default function TelegramAdminPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [queue, setQueue] = useState<Candidate[]>([]);
  const [kind, setKind] = useState("qa");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, EvidenceMsg[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ id: "", title: "", defaultCircle: "اقامت", chatId: "", kind: "export", lang: "fa" });

  const load = useCallback(async () => {
    try {
      const [s, q, r] = await Promise.all([
        api("sources"),
        api(`candidates?kind=${kind}&limit=40`),
        api("runs"),
      ]);
      setSources(s.sources ?? []);
      setQueue(q.candidates ?? []);
      setRuns(r.runs ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const saveSource = async () => {
    if (!form.id || !form.defaultCircle) return;
    setBusy("source");
    try {
      await api("sources", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, id: "", title: "", chatId: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  /** Reads the export in the browser and posts it as a string — no file storage anywhere. */
  const ingest = async (sourceId: string, file: File) => {
    setBusy(`ingest:${sourceId}`);
    setNote(`parsing ${(file.size / 1e6).toFixed(1)} MB…`);
    try {
      const text = await file.text();
      const report = await api("ingest/export", {
        method: "POST",
        body: JSON.stringify({ sourceId, export: text }),
      });
      setNote(
        `${report.messagesNew} new of ${report.messagesSeen} · ` +
        `${report.candidates.qa} Q&A, ${report.candidates.outcome} outcomes, ${report.candidates.provider} providers` +
        (report.warnings?.length ? ` · ${report.warnings.length} warning(s)` : ""),
      );
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setNote(null); }
    finally { setBusy(null); }
  };

  const rerun = async (sourceId: string) => {
    setBusy(`run:${sourceId}`);
    try {
      const r = await api(`run/${encodeURIComponent(sourceId)}`, { method: "POST" });
      setNote(`re-extracted ${r.messagesSeen} stored messages`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const decide = async (key: string, verdict: "approve" | "reject") => {
    setBusy(key);
    try {
      await api(`candidates/${encodeURIComponent(key)}/${verdict}`, { method: "POST" });
      setQueue((q) => q.filter((c) => c.key !== key));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const showEvidence = async (key: string) => {
    if (evidence[key]) { setEvidence(({ [key]: _drop, ...rest }) => rest); return; }
    try {
      const r = await api(`candidates/${encodeURIComponent(key)}/evidence`);
      setEvidence((e) => ({ ...e, [key]: r.evidence ?? [] }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of queue) c[q.kind] = (c[q.kind] ?? 0) + 1;
    return c;
  }, [queue]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Telegram connector</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-dim">
          Ingest a group export, mine it for question→answer pairs, outcome events and provider
          verdicts, then review each one before it becomes member-visible knowledge. Nothing here
          publishes automatically.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}
      {note && (
        <div className="rounded-lg border border-line bg-space/40 px-4 py-2 text-[13px] text-dim">{note}</div>
      )}

      {/* ---------------- sources ---------------- */}
      <section className={card}>
        <h2 className="mb-4 text-lg font-semibold text-ink">Watched groups</h2>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div><span className={label}>id</span>
            <input className={input} value={form.id} placeholder="irham-amoofarid"
              onChange={(e) => setForm({ ...form, id: e.target.value })} /></div>
          <div><span className={label}>title</span>
            <input className={input} value={form.title} placeholder="ارمنستان با عموفرید"
              onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><span className={label}>circle</span>
            <input className={input} value={form.defaultCircle}
              onChange={(e) => setForm({ ...form, defaultCircle: e.target.value })} /></div>
          <div><span className={label}>chat id (bot)</span>
            <input className={input} value={form.chatId} placeholder="-100…"
              onChange={(e) => setForm({ ...form, chatId: e.target.value })} /></div>
          <div><span className={label}>mode</span>
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="export">export</option><option value="bot">bot tail</option>
            </select></div>
          <div className="flex items-end">
            <button className={`${btn} w-full bg-gold/20 text-gold hover:bg-gold/30`}
              disabled={busy === "source" || !form.id} onClick={() => void saveSource()}>
              {busy === "source" ? "saving…" : "Add / update"}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {sources.length === 0 && <p className="text-[13px] text-dim">No sources yet.</p>}
          {sources.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-ink" dir="auto">{s.title}</div>
                <div className="text-[11px] text-dim">
                  <code>{s.id}</code> · → {s.defaultCircle} · {s.kind} · {s.lang}
                  {s.chatId ? ` · chat ${s.chatId}` : ""}
                </div>
              </div>
              <label className={`${btn} cursor-pointer bg-space/60 text-dim hover:text-ink`}>
                {busy === `ingest:${s.id}` ? "ingesting…" : "Upload export"}
                <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void ingest(s.id, f); e.target.value = ""; }} />
              </label>
              <button className={`${btn} bg-space/60 text-dim hover:text-ink`}
                disabled={busy === `run:${s.id}`} onClick={() => void rerun(s.id)}>
                {busy === `run:${s.id}` ? "running…" : "Re-extract"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- review queue ---------------- */}
      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">Review queue</h2>
          <div className="flex gap-1">
            {["qa", "outcome", "provider"].map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`${btn} ${kind === k ? "bg-gold/20 text-gold" : "bg-space/60 text-dim hover:text-ink"}`}>
                {k}{counts[k] ? ` (${counts[k]})` : ""}
              </button>
            ))}
          </div>
        </div>

        {queue.length === 0 && (
          <p className="text-[13px] text-dim">Nothing pending. Upload an export, or switch kind.</p>
        )}

        <div className="space-y-3">
          {queue.map((c) => {
            const p = c.payload as Record<string, string | number | boolean | string[]>;
            return (
              <article key={c.key} className="rounded-xl border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-dim">
                  <span className="rounded bg-space/60 px-1.5 py-0.5 font-mono">{c.kind}</span>
                  <span className="rounded bg-space/60 px-1.5 py-0.5 font-mono">
                    conf {Math.round(c.confidence * 100)}%
                  </span>
                  <span className="rounded bg-space/60 px-1.5 py-0.5 font-mono">{c.stage}</span>
                  <span>{c.sourceId}</span>
                  {c.kind === "qa" && !p.hasHardSpecific && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">no hard specific</span>
                  )}
                </div>

                {c.kind === "qa" && (
                  <>
                    <h3 className="text-[15px] font-bold text-ink" dir="auto">{String(p.title ?? "")}</h3>
                    {p.body ? <p className="mt-1 text-[12.5px] text-dim" dir="auto">{String(p.body)}</p> : null}
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/90" dir="auto">
                      {String(p.answer ?? "")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(Array.isArray(p.tags) ? p.tags : []).map((t) => (
                        <span key={String(t)} className="rounded bg-space/60 px-1.5 py-0.5 text-[11px] text-dim">{String(t)}</span>
                      ))}
                    </div>
                  </>
                )}

                {c.kind === "outcome" && (
                  <p className="text-[13.5px] text-ink/90">
                    <b>{String(p.step)}</b> → <b>{String(p.result)}</b>
                    {p.provider ? ` · ${String(p.provider)}` : ""}
                    {p.reasonCode ? ` · reason: ${String(p.reasonCode)}` : ""}
                    {p.costAmd ? ` · ${Number(p.costAmd).toLocaleString()} AMD` : ""}
                    {p.durationDays ? ` · ${String(p.durationDays)} days` : ""}
                  </p>
                )}

                {c.kind === "provider" && (
                  <p className="text-[13.5px] text-ink/90">
                    <b>{String(p.provider)}</b> ({String(p.category)}) — <b>{String(p.verdict)}</b>
                    {" · "}{String(p.reporters)} distinct reporters
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className={`${btn} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`}
                    disabled={busy === c.key} onClick={() => void decide(c.key, "approve")}>
                    {c.kind === "qa" ? "Approve → publish thread" : "Approve"}
                  </button>
                  <button className={`${btn} bg-space/60 text-dim hover:text-ink`}
                    disabled={busy === c.key} onClick={() => void decide(c.key, "reject")}>Reject</button>
                  <button className={`${btn} bg-space/60 text-dim hover:text-ink`}
                    onClick={() => void showEvidence(c.key)}>
                    {evidence[c.key] ? "Hide" : "Show"} evidence ({c.evidence.length})
                  </button>
                </div>

                {evidence[c.key] && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    {evidence[c.key].map((m) => (
                      <div key={m.id} className="rounded bg-space/40 p-2">
                        <div className="font-mono text-[10.5px] text-dim">
                          {m.date.slice(0, 10)} · {m.from} · {m.cls}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-dim" dir="auto">{m.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------------- runs ---------------- */}
      <section className={card}>
        <h2 className="mb-4 text-lg font-semibold text-ink">Recent runs</h2>
        {runs.length === 0 && <p className="text-[13px] text-dim">No runs yet.</p>}
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-4 py-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-dim">{r.finishedAt.slice(0, 16).replace("T", " ")}</span>
                <span className="text-ink">{r.sourceId}</span>
                <span className="text-dim">{r.inserted} new / {r.seen} seen</span>
                <span className="text-dim">
                  {Object.entries(r.candidates).map(([k, v]) => `${k}:${v}`).join(" · ")}
                </span>
              </div>
              {Object.keys(r.byClass ?? {}).length > 0 && (
                <div className="mt-1 font-mono text-[11px] text-dim">
                  {Object.entries(r.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ")}
                </div>
              )}
              {r.warnings?.map((w) => (
                <div key={w} className="mt-1 text-[11.5px] text-amber-300">⚠ {w}</div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
