"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Loader2, TrendingUp, Users } from "lucide-react";

interface SurveySummary {
  total: number;
  matchesShownRate: number;
  joinedRate: number;
  breakdown: {
    stage: Record<string, number>;
    biggestNeed: Record<string, number>;
    workaround: Record<string, number>;
    wtpSession: Record<string, number>;
    wtpSubscription: Record<string, number>;
  };
  topicCounts: Record<string, number>;
  coverage: Record<string, { specialists: number; circles: number }>;
}

const QUESTION_LABEL: Record<keyof SurveySummary["breakdown"], string> = {
  stage: "Relocation stage",
  biggestNeed: "Biggest need",
  workaround: "Current workaround",
  wtpSession: "Willingness to pay — per session",
  wtpSubscription: "Willingness to pay — subscription",
};

const OPTION_LABEL: Record<string, string> = {
  exploring: "Just exploring", planning: "Actively planning", recently_arrived: "Recently arrived", settled: "Settled",
  legal: "Legal & visa", housing: "Housing", banking: "Banking", career: "Career",
  ask_network: "Ask network", search_myself: "Search myself", hired_online: "Hired online", no_reliable_help: "No reliable help",
  free_only: "Free only", "5_15": "$5–15", "15_30": "$15–30", "30_plus": "$30+",
  "3_7": "$3–7/mo", "7_15": "$7–15/mo", "15_plus": "$15+/mo",
};

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

export default function SurveyAdminPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<SurveySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/survey/summary", { cache: "no-store" });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `fetch failed (${r.status})`);
        setData((await r.json()) as SurveySummary);
        setStatus("ok");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-faint" />
          <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Market-test survey
          </h1>
        </div>
        <p className="mt-1 text-sm text-dim">
          The public /survey link's results: what Iranians relocating actually need, what they&rsquo;d pay, and where
          the specialist/circle catalog has coverage gaps.
        </p>
      </header>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-dim">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      )}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && data && data.total === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <Users className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">No responses yet</p>
          <p className="mt-1 text-[13px] text-faint">Share the /survey link to start the market test.</p>
        </div>
      )}

      {status === "ok" && data && data.total > 0 && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <StatTile label="Responses" value={String(data.total)} />
            <StatTile label="Saw real matches" value={`${Math.round(data.matchesShownRate * 100)}%`} />
            <StatTile label="Clicked Join" value={`${Math.round(data.joinedRate * 100)}%`} />
          </div>

          {(Object.keys(QUESTION_LABEL) as (keyof SurveySummary["breakdown"])[]).map((key) => (
            <Breakdown key={key} title={QUESTION_LABEL[key]} counts={data.breakdown[key]} total={data.total} />
          ))}

          <div className="mt-6 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-faint" />
              <h2 className="text-[14px] font-bold text-ink">Coverage gaps by need</h2>
            </div>
            <p className="mt-1 text-[12.5px] text-dim">
              Topics respondents ask about, and how many admin-tagged specialists / OPEN circles currently exist for
              each — a zero here is where to recruit or tag next.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {Object.entries(data.topicCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([topic, count]) => {
                  const cov = data.coverage[topic] ?? { specialists: 0, circles: 0 };
                  const gap = cov.specialists === 0 && cov.circles === 0;
                  return (
                    <li key={topic} className="flex items-center justify-between py-2 text-[12.5px]">
                      <span className="capitalize text-ink">{topic.replace(/_/g, " ")}</span>
                      <span className="flex items-center gap-3 text-dim">
                        <span>{count} asked</span>
                        <span className={gap ? "font-semibold text-rose-300" : "text-emerald-400"}>
                          {cov.specialists} experts · {cov.circles} circles
                        </span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
      <div className="text-[20px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
        {value}
      </div>
      <div className="mt-0.5 text-[11.5px] text-faint">{label}</div>
    </div>
  );
}

function Breakdown({ title, counts, total }: { title: string; counts: Record<string, number>; total: number }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
      <h3 className="text-[13px] font-bold text-ink">{title}</h3>
      <div className="mt-2.5 space-y-2">
        {rows.map(([option, count]) => (
          <div key={option}>
            <div className="mb-1 flex items-center justify-between text-[12px] text-dim">
              <span>{OPTION_LABEL[option] ?? option}</span>
              <span>
                {count} · {pct(count, total)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct(count, total)}%`, background: "var(--color-accent)" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
