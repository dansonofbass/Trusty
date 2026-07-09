"use client";

import { useCallback, useEffect, useState } from "react";

/* Shape returned by GET/PUT /api/admin/extractor (proxied to the extractor). */
interface AdminState {
  effective: {
    default: string;
    abTest: string;
    overrideAllowed: boolean;
    providers: { ollama: string; claude: string; heuristic: string };
  };
  overrides: { defaultKey?: string; abTest?: string; abSalt?: string; allowOverride?: boolean };
  meta: { persisted: boolean; updatedAt?: string; updatedBy?: string };
  base: { default: string; claudeModel: string; ollamaModel: string };
  suggestions: { key: string; available: boolean; label: string }[];
}

const card = "rounded-2xl border border-line bg-surface backdrop-blur-md p-6";
const label = "block text-[11px] font-semibold uppercase tracking-[0.18em] text-dim mb-2";
const input =
  "w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-ink outline-none focus:border-gold/60";

export default function ExtractionPage() {
  const [state, setState] = useState<AdminState | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [defaultKey, setDefaultKey] = useState("");
  const [abTest, setAbTest] = useState("");
  const [abSalt, setAbSalt] = useState("");
  const [allowOverride, setAllowOverride] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const hydrate = useCallback((s: AdminState) => {
    setState(s);
    setDefaultKey(s.overrides.defaultKey ?? "");
    setAbTest(s.overrides.abTest ?? "");
    setAbSalt(s.overrides.abSalt ?? "");
    setAllowOverride(s.overrides.allowOverride ?? s.effective.overrideAllowed);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/extractor", { cache: "no-store" });
      if (!r.ok) { setError((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`); return setStatus("error"); }
      hydrate((await r.json()) as AdminState);
      setStatus("ok");
    })();
  }, [hydrate]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/extractor", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultKey, abTest, abSalt, allowOverride }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      hydrate(body as AdminState);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Extraction model</h1>
        <p className="mt-1 text-sm text-dim">Choose which model turns writing into graph structure — set a default, A/B-test across users, or lock it down.</p>
      </header>

      {status === "loading" && <p className="text-dim">Loading…</p>}
      {status === "error" && <div className={card}><p className="text-ink">Couldn&apos;t load the config.</p><p className="mt-2 text-sm text-rose-300">{error}</p></div>}

      {status === "ok" && state && (
        <div className="space-y-6">
          <section className={card}>
            <h2 className={label}>Currently live</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-dim">Default</dt><dd className="text-ink">{state.effective.default}</dd>
              <dt className="text-dim">A/B test</dt><dd className="text-ink">{state.effective.abTest}</dd>
              <dt className="text-dim">Manual override</dt><dd className="text-ink">{state.effective.overrideAllowed ? "allowed" : "locked"}</dd>
              <dt className="text-dim">Claude</dt><dd className="text-ink">{state.effective.providers.claude}</dd>
              <dt className="text-dim">Ollama</dt><dd className="text-ink">{state.effective.providers.ollama}</dd>
            </dl>
            <p className="mt-4 text-xs text-faint">
              {state.meta.persisted ? "Saved to Postgres" : "In-memory (resets on restart)"}
              {state.meta.updatedBy ? ` · last set by ${state.meta.updatedBy}` : ""}
              {state.meta.updatedAt ? ` · ${new Date(state.meta.updatedAt).toLocaleString()}` : ""}
            </p>
          </section>

          <section className={card}>
            <h2 className={label}>Monitoring &amp; cost</h2>
            <p className="text-sm text-dim">Every extraction runs through the LiteLLM gateway and is traced to Langfuse — input, output, tokens, and cost, tagged with the A/B variant and user.</p>
            <a href="http://localhost:3001" target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg border border-line px-4 py-2 text-sm text-ink hover:border-gold/60">Open Langfuse dashboard ↗</a>
          </section>

          <section className={card}>
            <label className={label} htmlFor="defaultKey">Default model</label>
            <input id="defaultKey" className={input} value={defaultKey} placeholder={`env default: ${state.base.default}`} onChange={(e) => setDefaultKey(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
              {state.suggestions.filter((s) => s.available).map((s) => (
                <button key={s.key} type="button" onClick={() => setDefaultKey(s.key)} className="rounded-full border border-line px-3 py-1 text-xs text-dim hover:border-gold/60 hover:text-ink">{s.label}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">Leave blank to use the env default. Accepts a provider (<code>ollama</code>, <code>claude</code>, <code>heuristic</code>) or a specific model id.</p>
          </section>

          <section className={card}>
            <label className={label} htmlFor="abTest">A/B test (per user, sticky)</label>
            <input id="abTest" className={input} value={abTest} placeholder="disabled — e.g. claude=50,ollama=50" onChange={(e) => setAbTest(e.target.value)} />
            <p className="mt-2 text-xs text-faint"><code>key=weight,key=weight</code>. Each user is hashed to one arm and stays there. Blank disables the experiment.</p>
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">Assignment salt</label>
            <input className={`${input} mt-2`} value={abSalt} placeholder="constellation — change to re-shuffle" onChange={(e) => setAbSalt(e.target.value)} />
          </section>

          <section className={card}>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={allowOverride} onChange={(e) => setAllowOverride(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
              <span className="text-ink">Allow per-request manual override</span>
            </label>
            <p className="mt-2 text-xs text-faint">When on, callers may force a model via the <code>x-extractor-model</code> / <code>x-extractor-provider</code> headers. Turn off to lock everyone to the routing above.</p>
          </section>

          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex items-center gap-4">
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-gold px-5 py-2 font-semibold text-space disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            {savedAt && <span className="text-xs text-faint">Saved at {savedAt}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
