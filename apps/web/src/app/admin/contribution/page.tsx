"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, Loader2, Play, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

interface Factor { kind: string; category: string; count: number; value: number; phrase: string }
interface Row {
  userId: string;
  name?: string;
  email?: string;
  accountStatus?: string;
  score: number;
  stage: string;
  events: number;
  lifetime: number;
  momentum: number;
  consistency: number;
  diversity: number;
  capacity: number;
  factors: Factor[];
}
interface Overview {
  envConfig: Record<string, number>;
  listen: { baseSlots: number; contributionPerSlot: number; maxSlots: number };
  users: Row[];
}

/** The tunable knobs, mirrored from ContributionConfig (simulation only). */
interface Knobs {
  momentumHalfLifeDays: number;
  burstDecay: number;
  lifetimeWeight: number;
  momentumWeight: number;
  recordedMultiplier: number;
}
const KNOB_META: { key: keyof Knobs; label: string; step: number; hint: string }[] = [
  { key: "momentumHalfLifeDays", label: "Momentum half-life (days)", step: 10, hint: "How fast recent-value emphasis fades. Lifetime value never decays." },
  { key: "burstDecay", label: "Burst decay", step: 0.05, hint: "The nth same-kind event in one day is worth decay^(n-1). Lower = harsher on flooding." },
  { key: "lifetimeWeight", label: "Lifetime weight", step: 0.05, hint: "Weight of the never-decaying history component." },
  { key: "momentumWeight", label: "Momentum weight", step: 0.05, hint: "Weight of the recency component." },
  { key: "recordedMultiplier", label: "Recorded (pending) multiplier", step: 0.05, hint: "Value of a submitted-but-not-yet-validated contribution. Validated/accepted earn 1×; rejected always 0." },
];

const STAGE_COLOR: Record<string, string> = {
  "New Contributor": "#8e97bd",
  "Occasional Contributor": "#7fb5e0",
  "Active Contributor": "#3fc6f4",
  "Reliable Contributor": "#54d26e",
  "Trusted Contributor": "#d9c956",
  "Knowledge Builder": "#ffa94d",
  "Community Expert": "#ff8c5a",
};

export default function ContributionAdminPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Overview | null>(null);
  const [simulated, setSimulated] = useState<Overview | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [knobs, setKnobs] = useState<Knobs | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/contribution", { cache: "no-store" });
      if (!r.ok) throw new Error(`contribution fetch failed (${r.status})`);
      const data = (await r.json()) as Overview;
      setBaseline(data);
      setKnobs({
        momentumHalfLifeDays: data.envConfig.momentumHalfLifeDays ?? 90,
        burstDecay: data.envConfig.burstDecay ?? 0.7,
        lifetimeWeight: data.envConfig.lifetimeWeight ?? 0.7,
        momentumWeight: data.envConfig.momentumWeight ?? 0.3,
        recordedMultiplier: 0.25,
      });
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const simulate = async () => {
    if (!knobs) return;
    setSimBusy(true);
    try {
      const r = await fetch("/api/admin/contribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: {
            momentumHalfLifeDays: knobs.momentumHalfLifeDays,
            burstDecay: knobs.burstDecay,
            lifetimeWeight: knobs.lifetimeWeight,
            momentumWeight: knobs.momentumWeight,
            statusMultiplier: { recorded: knobs.recordedMultiplier },
          },
        }),
      });
      if (r.ok) setSimulated((await r.json()) as Overview);
    } finally {
      setSimBusy(false);
    }
  };

  const simScore = useMemo(() => {
    if (!simulated) return new Map<string, number>();
    return new Map(simulated.users.map((u) => [u.userId, u.score] as const));
  }, [simulated]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Contribution</h1>
        <p className="mt-1 text-sm text-dim">
          Every user&apos;s evidence-derived contribution score — the number that earns Listen capacity.
          Tune the knobs to <em>simulate</em> a re-weighting; permanent changes are the <code className="text-gold">CONTRIB_*</code> env vars.
          Scores are recomputed live from evidence, never stored.
        </p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && baseline && knobs && (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* tuning panel */}
          <aside className="w-full shrink-0 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md lg:w-72">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink"><Gauge size={15} /> Algorithm tuning</div>
            <div className="space-y-3">
              {KNOB_META.map((k) => (
                <label key={k.key} className="block">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-dim">{k.label}</span>
                    <span className="text-[12px] font-semibold text-ink">{knobs[k.key]}</span>
                  </div>
                  <input
                    type="number" step={k.step} value={knobs[k.key]}
                    onChange={(e) => setKnobs({ ...knobs, [k.key]: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-line bg-space/60 px-2 py-1 text-[12.5px] text-ink outline-none focus:border-gold/60"
                  />
                  <div className="mt-0.5 text-[10.5px] leading-snug text-faint">{k.hint}</div>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void simulate()} disabled={simBusy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-[12.5px] font-semibold text-space disabled:opacity-50">
                {simBusy ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />} Simulate
              </button>
              <button onClick={() => { setSimulated(null); void load(); }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-dim hover:text-ink">
                <RotateCcw size={13} /> Reset
              </button>
            </div>
            <div className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
              Listen capacity: {baseline.listen.baseSlots} base + 1 slot / {baseline.listen.contributionPerSlot} points, max {baseline.listen.maxSlots}.
              Rejected contributions are always worth 0 (not tunable).
            </div>
          </aside>

          {/* leaderboard */}
          <div className="min-w-0 flex-1">
            {baseline.users.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-10 text-center text-[13px] text-faint backdrop-blur-md">No users yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface backdrop-blur-md">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
                      <th className="px-3 py-2.5">User</th>
                      <th className="px-3 py-2.5 text-right">Score</th>
                      {simulated && <th className="px-3 py-2.5 text-right text-gold">Simulated</th>}
                      <th className="px-3 py-2.5">Stage</th>
                      <th className="px-3 py-2.5 text-right">Events</th>
                      <th className="px-3 py-2.5 text-right">Capacity</th>
                      <th className="px-3 py-2.5 text-right">Consistency</th>
                      <th className="w-8 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {baseline.users.map((u) => {
                      const sim = simScore.get(u.userId);
                      const delta = sim !== undefined ? sim - u.score : undefined;
                      const open = expanded === u.userId;
                      return (
                        <Fragment key={u.userId}>
                          <tr className="border-b border-line/50 hover:bg-space/40">
                            <td className="max-w-52 px-3 py-2">
                              <div className="truncate font-semibold text-ink">{u.name ?? u.userId}</div>
                              <div className="truncate text-[11px] text-faint">{u.email ?? u.accountStatus ?? ""}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-ink">{u.score}</td>
                            {simulated && (
                              <td className="px-3 py-2 text-right">
                                <span className="font-semibold text-gold">{sim ?? "–"}</span>
                                {delta !== undefined && delta !== 0 && (
                                  <span className={`ml-1 text-[10.5px] ${delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {delta > 0 ? "+" : ""}{Math.round(delta * 100) / 100}
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2">
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                style={{ background: `${STAGE_COLOR[u.stage] ?? "#8e97bd"}22`, color: STAGE_COLOR[u.stage] ?? "#8e97bd" }}>
                                {u.stage}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-dim">{u.events}</td>
                            <td className="px-3 py-2 text-right text-dim">{u.capacity}</td>
                            <td className="px-3 py-2 text-right text-dim">×{u.consistency}</td>
                            <td className="px-2 py-2">
                              {u.factors.length > 0 && (
                                <button onClick={() => setExpanded(open ? null : u.userId)} className="text-faint hover:text-ink" aria-label="Factors">
                                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-line/50 bg-space/30">
                              <td colSpan={simulated ? 8 : 7} className="px-5 py-2.5">
                                <ul className="space-y-1">
                                  {u.factors.map((f) => (
                                    <li key={f.kind} className="flex items-baseline gap-2 text-[12px]">
                                      <span className="rounded bg-space/60 px-1.5 py-0.5 font-mono text-[10.5px] text-dim">{f.kind}×{f.count}</span>
                                      <span className="text-dim">{f.phrase}</span>
                                      <span className="ml-auto shrink-0 text-faint">{f.value}</span>
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-1.5 text-[10.5px] text-faint">
                                  lifetime {u.lifetime} · momentum {u.momentum} · consistency ×{u.consistency} · diversity ×{u.diversity}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
