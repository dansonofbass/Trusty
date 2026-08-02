"use client";

/**
 * AI models — the operator's cockpit: compare models and what they cost, pick
 * which model each plan tier gets, run an A/B, and see what we're actually
 * spending (real tokens + LiteLLM's own prices, so the numbers match the bill).
 */
import { useCallback, useEffect, useState } from "react";
import { Cpu, Gauge, Loader2, RefreshCw, Zap } from "lucide-react";

interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  inputPer1M: number;
  outputPer1M: number;
  speed: "fastest" | "fast" | "balanced" | "deep";
  available: boolean;
}

interface RoutingState {
  effective: { default: string; abTest: string; overrideAllowed: boolean };
  overrides: { defaultKey?: string; abTest?: string; abSalt?: string; allowOverride?: boolean };
  tierModels: Record<string, string>;
  meta: { persisted: boolean; updatedAt?: string; updatedBy?: string };
  suggestions: { key: string; available: boolean; label: string }[];
}

interface UsageSummary {
  windowDays: number;
  totals: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
  byModel: { model: string; calls: number; tokens: number; costUsd: number }[];
  byDay: { day: string; calls: number; costUsd: number }[];
  byEndpoint: { endpoint: string; calls: number; costUsd: number }[];
  topUsers: { userId: string; label?: string; calls: number; costUsd: number }[];
  tiers: string[];
  tierCounts: Record<string, number>;
}

const SPEED_BADGE: Record<string, { label: string; color: string }> = {
  fastest: { label: "Fastest", color: "#54d26e" },
  fast: { label: "Fast", color: "#54d26e" },
  balanced: { label: "Balanced", color: "#3fc6f4" },
  deep: { label: "Deepest", color: "#e25cff" },
};

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0");
const card = "rounded-2xl border border-line bg-surface backdrop-blur-md p-5";

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [routing, setRouting] = useState<RoutingState | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadModels = useCallback(async (refresh = false) => {
    const r = await fetch(`/api/admin/extractor/models${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (r.ok) setModels(((await r.json()) as { models: ModelInfo[] }).models);
  }, []);

  const loadRouting = useCallback(async () => {
    const r = await fetch("/api/admin/extractor", { cache: "no-store" });
    if (r.ok) setRouting((await r.json()) as RoutingState);
    else setError((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  }, []);

  const loadUsage = useCallback(async (d: number) => {
    const r = await fetch(`/api/admin/llm-usage?days=${d}`, { cache: "no-store" });
    if (r.ok) setUsage((await r.json()) as UsageSummary);
  }, []);

  useEffect(() => {
    void loadModels();
    void loadRouting();
  }, [loadModels, loadRouting]);
  useEffect(() => {
    void loadUsage(days);
  }, [loadUsage, days]);

  const saveTier = async (tier: string, model: string) => {
    if (!routing) return;
    setSaving(true);
    setError(null);
    const next = { ...routing.tierModels, [tier]: model };
    if (!model) delete next[tier];
    try {
      const r = await fetch("/api/admin/extractor", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tierModels: next }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      setRouting(body as RoutingState);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  const tiers = usage?.tiers ?? ["free", "premium"];
  const maxDayCost = Math.max(1e-9, ...(usage?.byDay ?? []).map((d) => d.costUsd));

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6">
      <h1 className="flex items-center gap-2 text-[20px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
        <Cpu size={18} /> AI models
      </h1>
      <p className="mb-5 mt-1 text-[13px] text-dim">
        Compare models and prices, choose what each plan tier gets, and watch what it costs.
      </p>

      {error && <p className="mb-3 rounded-lg bg-[rgba(253,164,175,0.1)] px-3 py-2 text-[12.5px] text-[#fda4af]">{error}</p>}

      {/* Catalog + pricing comparison */}
      <section className={`${card} mb-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">Catalog & pricing</h2>
          <button
            type="button"
            onClick={() => void loadModels(true)}
            className="flex items-center gap-1 text-[11.5px] text-dim transition hover:text-ink"
          >
            <RefreshCw size={11} /> refresh
          </button>
        </div>
        {!models ? (
          <p className="py-4 text-center text-[13px] text-faint"><Loader2 size={14} className="inline animate-spin" /></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.1em] text-faint">
                  <th className="py-2 text-start font-semibold">Model</th>
                  <th className="py-2 text-end font-semibold">Input / 1M</th>
                  <th className="py-2 text-end font-semibold">Output / 1M</th>
                  <th className="py-2 text-end font-semibold">~Cost / 1k msgs</th>
                  <th className="py-2 text-end font-semibold">Used for</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const badge = SPEED_BADGE[m.speed];
                  // A rough, comparable yardstick: ~2k in + ~400 out per message.
                  const per1k = (2000 * m.inputPer1M + 400 * m.outputPer1M) / 1e6 * 1000;
                  const usedBy = Object.entries(routing?.tierModels ?? {}).filter(([, v]) => v === m.id).map(([k]) => k);
                  const isDefault = routing?.effective.default === m.id;
                  return (
                    <tr key={m.id} className="border-b border-line/50">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{m.label}</span>
                          <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: `${badge.color}22`, color: badge.color }}>
                            {badge.label}
                          </span>
                          {!m.available && <span className="text-[10px] text-faint">(not configured)</span>}
                        </div>
                        <div className="text-[11px] text-faint">{m.blurb}</div>
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-dim">${m.inputPer1M.toFixed(2)}</td>
                      <td className="py-2.5 text-end tabular-nums text-dim">${m.outputPer1M.toFixed(2)}</td>
                      <td className="py-2.5 text-end tabular-nums font-semibold text-ink">{usd(per1k)}</td>
                      <td className="py-2.5 text-end text-[11.5px]">
                        {isDefault && <span className="me-1 rounded-full bg-[rgba(146,166,255,0.14)] px-2 py-0.5 text-[10px] text-ink">default</span>}
                        {usedBy.map((t) => (
                          <span key={t} className="me-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                            {t}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tier → model */}
      <section className={`${card} mb-5`}>
        <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">
          <Zap size={12} /> Model per plan
        </h2>
        <p className="mb-3 text-[12px] text-dim">
          Which model answers each tier. Leave a tier empty to use the global default / A-B test.
          Change a person&apos;s tier in <b>Directory</b>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {tiers.map((tier) => (
            <label key={tier} className="rounded-xl border border-line p-3">
              <span className="mb-1.5 flex items-center justify-between text-[12.5px] font-semibold capitalize text-ink">
                {tier}
                <span className="text-[10.5px] font-normal text-faint">
                  {usage?.tierCounts?.[tier] ?? 0} user{(usage?.tierCounts?.[tier] ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
              <select
                value={routing?.tierModels?.[tier] ?? ""}
                disabled={saving || !models}
                onChange={(e) => void saveTier(tier, e.target.value)}
                className="w-full rounded-lg border border-line bg-space/60 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-gold/60"
              >
                <option value="">— default —</option>
                {(models ?? []).filter((m) => m.available).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {savedAt && <p className="mt-2 text-[11.5px] text-[#54d26e]">Saved at {savedAt}</p>}
      </section>

      {/* Cost insights */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">
            <Gauge size={12} /> Spend
          </h2>
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition"
                style={days === d
                  ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                  : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {!usage ? (
          <p className="py-4 text-center text-[13px] text-faint"><Loader2 size={14} className="inline animate-spin" /></p>
        ) : usage.totals.calls === 0 ? (
          <p className="py-3 text-[13px] text-dim">No model calls recorded in this window yet.</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Total cost", value: usd(usage.totals.costUsd) },
                { label: "Calls", value: usage.totals.calls.toLocaleString() },
                { label: "Tokens in", value: usage.totals.promptTokens.toLocaleString() },
                { label: "Tokens out", value: usage.totals.completionTokens.toLocaleString() },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-line p-3">
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-faint">{s.label}</div>
                  <div className="mt-0.5 text-[16px] font-bold text-ink tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>

            {/* daily spend sparkline */}
            <div className="mb-4">
              <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-faint">Daily cost</div>
              <div className="flex h-16 items-end gap-0.5">
                {usage.byDay.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${usd(d.costUsd)} · ${d.calls} calls`}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${Math.max(4, (d.costUsd / maxDayCost) * 100)}%`,
                      background: "var(--color-accent)",
                      opacity: 0.75,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-faint">By model</div>
                <ul className="space-y-1">
                  {usage.byModel.map((m) => (
                    <li key={m.model} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="truncate text-ink">{m.model}</span>
                      <span className="shrink-0 tabular-nums text-dim">
                        {usd(m.costUsd)} <span className="text-faint">· {m.calls}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-faint">Top users</div>
                <ul className="space-y-1">
                  {usage.topUsers.map((u) => (
                    <li key={u.userId} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="truncate text-ink">{u.label ?? u.userId}</span>
                      <span className="shrink-0 tabular-nums text-dim">
                        {usd(u.costUsd)} <span className="text-faint">· {u.calls}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
