"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Gauge, Loader2, Play, RotateCcw, ChevronDown, ChevronRight, Coins, Info, FlaskConical, Plus,
} from "lucide-react";

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
  capacityBreakdown: { base: number; fromContribution: number; fromTenure: number; fromBoosts: number };
  credits: { earned: number; ledger: number; balance: number };
  factors: Factor[];
}
interface Overview {
  envConfig: Record<string, number>;
  listen: { baseSlots: number; contributionPerSlot: number; maxSlots: number; weeksPerSlot: number };
  credits: { pointsPerCredit: number; boostCost: number };
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
  { key: "momentumHalfLifeDays", label: "Momentum half-life (days)", step: 10, hint: "How long recent work keeps its recency bonus. History itself never decays." },
  { key: "burstDecay", label: "Burst decay", step: 0.05, hint: "Repeating the same action within one day: each repeat is worth this fraction of the previous. Lower = harsher on spam." },
  { key: "lifetimeWeight", label: "Lifetime weight", step: 0.05, hint: "How much all-time accumulated value counts." },
  { key: "momentumWeight", label: "Momentum weight", step: 0.05, hint: "How much recent value counts extra." },
  { key: "recordedMultiplier", label: "Pending-submission value", step: 0.05, hint: "Worth of a suggestion still awaiting moderation (approved = 1×, rejected = always 0)." },
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
  const [liveKnobs, setLiveKnobs] = useState<Knobs | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [granting, setGranting] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState("5");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/contribution", { cache: "no-store" });
      if (!r.ok) throw new Error(`contribution fetch failed (${r.status})`);
      const raw = (await r.json()) as Partial<Overview> & { users?: Partial<Row>[] };
      // Normalize defensively — an older graph-service may not send the newer
      // fields (credits, capacityBreakdown); render with defaults, never crash.
      const data: Overview = {
        envConfig: raw.envConfig ?? {},
        listen: { baseSlots: 5, contributionPerSlot: 5, maxSlots: 50, weeksPerSlot: 4, ...raw.listen },
        credits: { pointsPerCredit: 2, boostCost: 3, ...raw.credits },
        users: (raw.users ?? []).map((u) => ({
          events: 0, lifetime: 0, momentum: 0, consistency: 1, diversity: 1,
          capacity: 0, score: 0, stage: "New Contributor", userId: "", factors: [],
          capacityBreakdown: { base: 5, fromContribution: 0, fromTenure: 0, fromBoosts: 0 },
          credits: { earned: 0, ledger: 0, balance: 0 },
          ...u,
        }) as Row),
      };
      setBaseline(data);
      const live: Knobs = {
        momentumHalfLifeDays: data.envConfig.momentumHalfLifeDays ?? 90,
        burstDecay: data.envConfig.burstDecay ?? 0.7,
        lifetimeWeight: data.envConfig.lifetimeWeight ?? 0.7,
        momentumWeight: data.envConfig.momentumWeight ?? 0.3,
        recordedMultiplier: 0.25,
      };
      setLiveKnobs(live);
      setKnobs((k) => k ?? { ...live });
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

  const grant = async (userId: string) => {
    const amount = Math.floor(Number(grantAmount));
    if (!Number.isFinite(amount) || amount < 1) return;
    setGranting(null);
    await fetch(`/api/admin/credits/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, note: "admin panel grant" }),
    }).catch(() => null);
    await load();
    if (simulated) await simulate();
  };

  const simScore = useMemo(() => {
    if (!simulated) return new Map<string, number>();
    return new Map(simulated.users.map((u) => [u.userId, u.score] as const));
  }, [simulated]);

  const impact = useMemo(() => {
    if (!simulated || !baseline) return null;
    let up = 0, down = 0, same = 0;
    for (const u of baseline.users) {
      const s = simScore.get(u.userId);
      if (s === undefined) continue;
      if (s > u.score) up += 1;
      else if (s < u.score) down += 1;
      else same += 1;
    }
    return { up, down, same };
  }, [simulated, baseline, simScore]);

  const knobsDirty = useMemo(
    () => !!knobs && !!liveKnobs && KNOB_META.some((k) => knobs[k.key] !== liveKnobs[k.key]),
    [knobs, liveKnobs],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Contribution</h1>
        <p className="mt-1 max-w-3xl text-sm text-dim">
          Every user&apos;s evidence-derived contribution score, with the Listen capacity and Credits it earns.
          Scores are recomputed live from evidence — never stored.
        </p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && baseline && knobs && liveKnobs && (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* what-if simulator */}
          <aside className="w-full shrink-0 self-start rounded-2xl border border-line bg-surface p-4 backdrop-blur-md lg:w-80">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <FlaskConical size={15} /> What-if simulator
            </div>
            <div className="mb-3 flex items-start gap-1.5 rounded-lg bg-space/50 p-2 text-[11px] leading-snug text-faint">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>
                Nothing here changes the live algorithm. Adjust a knob, hit <b className="text-dim">Preview</b>, and the table
                shows what every score <em>would</em> become — so you can see who a re-weighting helps or hurts before
                committing. To make it permanent, set the matching <code className="text-gold">CONTRIB_*</code> env var and restart.
              </span>
            </div>
            <div className="space-y-3">
              {KNOB_META.map((k) => {
                const changed = knobs[k.key] !== liveKnobs[k.key];
                return (
                  <label key={k.key} className="block">
                    <div className="flex items-baseline justify-between">
                      <span className={`text-[12px] ${changed ? "font-semibold text-gold" : "text-dim"}`}>{k.label}</span>
                      <span className="text-[10.5px] text-faint">live: {liveKnobs[k.key]}</span>
                    </div>
                    <input
                      type="number" step={k.step} value={knobs[k.key]}
                      onChange={(e) => setKnobs({ ...knobs, [k.key]: Number(e.target.value) })}
                      className={`mt-1 w-full rounded-lg border bg-space/60 px-2 py-1 text-[12.5px] text-ink outline-none focus:border-gold/60 ${changed ? "border-gold/50" : "border-line"}`}
                    />
                    <div className="mt-0.5 text-[10.5px] leading-snug text-faint">{k.hint}</div>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void simulate()} disabled={simBusy || !knobsDirty}
                title={knobsDirty ? "Recompute all scores with your values" : "Change a knob first"}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-[12.5px] font-semibold text-space disabled:opacity-40">
                {simBusy ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />} Preview
              </button>
              <button onClick={() => { setSimulated(null); setKnobs({ ...liveKnobs }); }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-dim hover:text-ink">
                <RotateCcw size={13} /> Reset
              </button>
            </div>
            {impact && (
              <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-2 text-[11.5px] text-dim">
                <b className="text-gold">Preview impact:</b>{" "}
                <span className="text-emerald-400">{impact.up} up</span> ·{" "}
                <span className="text-rose-400">{impact.down} down</span> ·{" "}
                {impact.same} unchanged
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-dim"><Gauge size={12} /> How scores become slots &amp; credits</div>
              1 Listen slot / {baseline.listen.contributionPerSlot} points (+1 per {baseline.listen.weeksPerSlot} weeks of membership) ·
              1 credit / {baseline.credits.pointsPerCredit} points · a capacity boost costs {baseline.credits.boostCost} credits.
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
                      {simulated && <th className="px-3 py-2.5 text-right text-gold">Preview</th>}
                      <th className="px-3 py-2.5">Stage</th>
                      <th className="px-3 py-2.5 text-right" title="Listen slots (base + contribution + tenure + boosts)">Slots</th>
                      <th className="px-3 py-2.5 text-right" title="Credit balance (earned from contribution + grants − spends)">Credits</th>
                      <th className="w-8 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {baseline.users.map((u) => {
                      const sim = simScore.get(u.userId);
                      const delta = sim !== undefined ? Math.round((sim - u.score) * 100) / 100 : undefined;
                      const open = expanded === u.userId;
                      const cb = u.capacityBreakdown;
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
                                    {delta > 0 ? "+" : ""}{delta}
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
                            <td className="px-3 py-2 text-right text-dim"
                              title={`base ${cb.base} + contribution ${cb.fromContribution} + tenure ${cb.fromTenure} + boosts ${cb.fromBoosts}`}>
                              {u.capacity}
                              {cb.fromBoosts > 0 && <span className="ml-0.5 text-[10px] text-gold">↑</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-dim">{u.credits.balance}</span>
                              <button onClick={() => { setGranting(granting === u.userId ? null : u.userId); setGrantAmount("5"); }}
                                title="Grant credits" className="ml-1.5 rounded p-0.5 text-faint hover:text-gold">
                                <Plus size={12} />
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <button onClick={() => setExpanded(open ? null : u.userId)} className="text-faint hover:text-ink" aria-label="Details">
                                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </button>
                            </td>
                          </tr>
                          {granting === u.userId && (
                            <tr className="border-b border-line/50 bg-space/30">
                              <td colSpan={simulated ? 7 : 6} className="px-5 py-2">
                                <div className="flex items-center gap-2 text-[12px] text-dim">
                                  <Coins size={13} className="text-gold" /> Grant
                                  <input type="number" min={1} max={1000} value={grantAmount}
                                    onChange={(e) => setGrantAmount(e.target.value)}
                                    className="w-20 rounded-lg border border-line bg-space/60 px-2 py-1 text-[12px] text-ink outline-none focus:border-gold/60" />
                                  credits to <b className="text-ink">{u.name ?? u.userId}</b> (auditable)
                                  <button onClick={() => void grant(u.userId)}
                                    className="rounded-lg bg-gold px-3 py-1 text-[11.5px] font-semibold text-space">Grant</button>
                                  <button onClick={() => setGranting(null)} className="text-[11.5px] text-faint hover:text-ink">Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {open && (
                            <tr className="border-b border-line/50 bg-space/30">
                              <td colSpan={simulated ? 7 : 6} className="px-5 py-2.5">
                                {u.factors.length > 0 ? (
                                  <ul className="space-y-1">
                                    {u.factors.map((f) => (
                                      <li key={f.kind} className="flex items-baseline gap-2 text-[12px]">
                                        <span className="rounded bg-space/60 px-1.5 py-0.5 font-mono text-[10.5px] text-dim">{f.kind}×{f.count}</span>
                                        <span className="text-dim">{f.phrase}</span>
                                        <span className="ml-auto shrink-0 text-faint">{f.value}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-[12px] text-faint">No contributions yet.</div>
                                )}
                                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10.5px] text-faint sm:grid-cols-4">
                                  <span>lifetime {u.lifetime} · momentum {u.momentum}</span>
                                  <span>consistency ×{u.consistency} · diversity ×{u.diversity}</span>
                                  <span>slots: {cb.base} base + {cb.fromContribution} contrib + {cb.fromTenure} tenure + {cb.fromBoosts} boost</span>
                                  <span>credits: {u.credits.earned} earned {u.credits.ledger >= 0 ? "+" : ""}{u.credits.ledger} ledger</span>
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
