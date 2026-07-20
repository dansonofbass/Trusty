"use client";

/**
 * Specialist intelligence dashboard (#40) — managers with analytics access.
 *
 * Intentionally simple: the most important findings in one short session,
 * not an enterprise analytics suite. Every widget is a 90-day aggregate,
 * k-anonymized upstream; the copy keeps repeating what numbers are NOT
 * (a view is not trust, a contact is not an experience).
 */
import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, Eye, Loader2, Lock, MousePointerClick,
  ShieldQuestion, Sprout, ThumbsDown, ThumbsUp, Users, Compass,
} from "lucide-react";
import Brand from "@/components/Brand";

interface Intelligence {
  visibility: {
    impressions: number;
    clicks: number;
    distinctUsers: number;
    intents: number;
    outcomesPositive: number;
    outcomesNegative: number;
    sufficiency: "insufficient" | "early_signal" | "developing" | "established";
    suppressed: boolean;
  };
  evidence: {
    recCount: number;
    outcomeCount: number;
    distinctContributors: number;
    topics: { topic: string; count: number }[];
    labelText: string;
  };
  drivers: { reason: string; count: number }[];
  gaps: string[];
  note: string;
}

const SUFFICIENCY_TEXT: Record<string, string> = {
  insufficient: "Insufficient data",
  early_signal: "Early signal",
  developing: "Developing pattern",
  established: "Established pattern",
};

export default function SpecialistDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Intelligence | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "forbidden" | "unsubscribed" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/specialists/${encodeURIComponent(id)}/intelligence`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 403) return setStatus("forbidden");
        if (r.status === 402) return setStatus("unsubscribed");
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `unavailable (${r.status})`);
        setData((await r.json()) as Intelligence);
        setStatus("ok");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => { alive = false; };
  }, [id]);

  const shell = (body: React.ReactNode) => (
    <div className="relative z-10 mx-auto min-h-[100dvh] max-w-2xl px-4 pb-16 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/s/${encodeURIComponent(id)}`} aria-label="Back to profile" className="text-faint hover:text-ink">
          <ArrowLeft size={17} />
        </Link>
        <Brand size={20} />
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">
          <BarChart3 size={12} /> Intelligence
        </span>
      </div>
      {body}
    </div>
  );

  if (status === "loading") return shell(<div className="grid place-items-center py-24 text-dim"><Loader2 className="animate-spin" size={22} /></div>);
  if (status === "forbidden") {
    return shell(
      <div className="panel rounded-2xl p-8 text-center">
        <Lock className="mx-auto mb-3 text-faint" size={26} />
        <p className="text-[14px] text-ink">Analytics is available to profile managers with analytics access.</p>
      </div>,
    );
  }
  if (status === "unsubscribed") {
    return shell(
      <div className="panel rounded-2xl p-8 text-center">
        <Sprout className="mx-auto mb-3" size={26} style={{ color: "var(--color-accent)" }} />
        <p className="text-[14.5px] font-semibold text-ink">Intelligence requires a professional subscription</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-dim">
          A subscription unlocks visibility and decision analytics. It never changes trust —
          trust comes only from independent recommendations and real outcomes, at any plan.
        </p>
        <p className="mt-3 text-[12px] text-faint">Ask a Trusty admin about pilot access.</p>
      </div>,
    );
  }
  if (status === "error" || !data) {
    return shell(<div className="panel rounded-2xl p-8 text-center text-[13.5px] text-rose-300">{error ?? "Unavailable"}</div>);
  }

  const v = data.visibility;
  const tile = (icon: React.ReactNode, label: string, value: number | string) => (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">{icon} {label}</div>
      <div className="mt-1 text-[20px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>{value}</div>
    </div>
  );

  return shell(
    <>
      {/* sufficiency banner */}
      <div className="panel flex items-center gap-2.5 rounded-2xl px-4 py-3">
        <ShieldQuestion size={15} className="shrink-0" style={{ color: "var(--color-accent)" }} />
        <div className="min-w-0">
          <span className="text-[12.5px] font-bold text-ink">{SUFFICIENCY_TEXT[v.sufficiency]}</span>
          <span className="ml-2 text-[12px] text-dim">{data.note}</span>
        </div>
      </div>

      {/* visibility */}
      <section className="panel mt-4 rounded-2xl p-5">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">Visibility · 90 days</h2>
        {v.suppressed ? (
          <p className="mt-3 text-[13px] text-dim">
            Hidden until at least 5 distinct members have interacted with your profile —
            aggregates must never identify an individual.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile(<Eye size={11} />, "Impressions", v.impressions)}
            {tile(<MousePointerClick size={11} />, "Profile clicks", v.clicks)}
            {tile(<Users size={11} />, "Distinct members", v.distinctUsers)}
            {tile(<Compass size={11} />, "Decision intents", v.intents)}
          </div>
        )}
      </section>

      {/* decision funnel */}
      {!v.suppressed && (
        <section className="panel mt-4 rounded-2xl p-5">
          <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">Decision funnel</h2>
          <div className="mt-3 space-y-1.5">
            {[
              ["Appeared / viewed", v.impressions + v.clicks],
              ["Contacted or intended to try", v.intents],
              ["Outcomes recorded", v.outcomesPositive + v.outcomesNegative],
            ].map(([label, n], i, all) => {
              const max = Math.max(1, Number(all[0][1]));
              return (
                <div key={String(label)} className="flex items-center gap-2">
                  <div className="w-44 shrink-0 text-[12px] text-dim">{label}</div>
                  <div className="h-4 min-w-[2px] rounded"
                    style={{ width: `${Math.max(2, (Number(n) / max) * 100)}%`, background: i === 0 ? "var(--color-accent-soft)" : "var(--color-accent)", opacity: i === 0 ? 1 : 0.85 }} />
                  <span className="text-[12px] font-semibold text-ink">{n}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-faint">
            A view is not trust · a contact is not a completed experience · low conversion can be
            relevance, information, availability, or price — not necessarily a trust problem.
          </p>
        </section>
      )}

      {/* trust intelligence */}
      <section className="panel mt-4 rounded-2xl p-5">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">Trust intelligence</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-dim">
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
            {data.evidence.labelText}
          </span>
          {data.evidence.recCount} recommendations · {data.evidence.outcomeCount} outcomes ·{" "}
          {data.evidence.distinctContributors} contributors
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-emerald-400"><ThumbsUp size={12} /> {v.outcomesPositive}</span>
            <span className="flex items-center gap-1 text-rose-300"><ThumbsDown size={12} /> {v.outcomesNegative}</span>
          </span>
        </div>

        {data.drivers.length > 0 && (
          <div className="mt-3">
            <div className="text-[11.5px] font-semibold text-dim">What contributors consistently mention</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.drivers.map((d) => (
                <span key={d.reason} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-dim">
                  {d.reason} × {d.count}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-faint">Derived from independent recommendations — you don&rsquo;t control these.</p>
          </div>
        )}

        {data.gaps.length > 0 && (
          <div className="mt-3">
            <div className="text-[11.5px] font-semibold text-dim">Evidence gaps</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
              You list {data.gaps.slice(0, 6).map((g, i) => (
                <span key={g}>{i > 0 && ", "}<b className="text-ink">{g}</b></span>
              ))}{" "}
              but Trusty has no independent evidence there yet. A gap doesn&rsquo;t mean you&rsquo;re bad at it —
              it means the platform can&rsquo;t confirm it yet. It fills only through real clients and outcomes.
            </p>
          </div>
        )}
      </section>
    </>,
  );
}
