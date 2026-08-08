"use client";

import { useEffect, useState } from "react";
import Brand from "@/components/Brand";

/**
 * Public market-test survey (no login — excluded from the proxy gate, see
 * proxy.ts). Five 4-option questions about relocation needs + willingness to
 * pay, then a results screen backed by REAL circles and admin-tagged, trust-
 * ranked specialists for the stated need — not a mockup. The CTA funnels into
 * the existing invite/waitlist auth flow; nothing about that flow changes.
 */

type QKey = "stage" | "biggestNeed" | "workaround" | "wtpSession" | "wtpSubscription";

interface Question {
  key: QKey;
  title: string;
  options: { value: string; label: string }[];
}

const QUESTIONS: Question[] = [
  {
    key: "stage",
    title: "Where are you in your relocation journey?",
    options: [
      { value: "exploring", label: "Just exploring" },
      { value: "planning", label: "Actively planning (visa in progress)" },
      { value: "recently_arrived", label: "Recently arrived (under 6 months)" },
      { value: "settled", label: "Settled, but still need help" },
    ],
  },
  {
    key: "biggestNeed",
    title: "What's the single biggest challenge right now?",
    options: [
      { value: "legal", label: "Legal & visa paperwork" },
      { value: "housing", label: "Housing & finding a place" },
      { value: "banking", label: "Banking, taxes & money" },
      { value: "career", label: "Job, career & local connections" },
    ],
  },
  {
    key: "workaround",
    title: "How do you currently find trustworthy help for this?",
    options: [
      { value: "ask_network", label: "Ask friends/family or Telegram groups" },
      { value: "search_myself", label: "Search Google/YouTube myself" },
      { value: "hired_online", label: "Hired someone online, hoping for the best" },
      { value: "no_reliable_help", label: "Haven't found reliable help yet" },
    ],
  },
  {
    key: "wtpSession",
    title: "Book a 15-min call with a vetted expert (lawyer, broker, accountant) — how much would you pay?",
    options: [
      { value: "free_only", label: "Only if it's free" },
      { value: "5_15", label: "$5–15" },
      { value: "15_30", label: "$15–30" },
      { value: "30_plus", label: "$30+" },
    ],
  },
  {
    key: "wtpSubscription",
    title: "How much would you pay per month for an app that helps you find trusted people & answers?",
    options: [
      { value: "free_only", label: "Nothing, free features only" },
      { value: "3_7", label: "$3–7/mo" },
      { value: "7_15", label: "$7–15/mo" },
      { value: "15_plus", label: "$15+/mo" },
    ],
  },
];

const NEED_LABEL: Record<string, string> = {
  legal: "legal & visa help",
  housing: "housing & real estate",
  banking: "banking & accounting",
  career: "career & local connections",
};

interface Circle {
  id: string;
  label: string;
  description: string;
  category: string;
  memberCount: number;
}

interface SpecialistCard {
  nodeId: string;
  label: string;
  nodeType: string;
  verified: boolean;
  trustLabel: string;
  trustLabelText: string;
}

export default function SurveyPage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<QKey, string>>>({});
  const [phase, setPhase] = useState<"asking" | "loading" | "results">("asking");
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistCard[] | null>(null);

  useEffect(() => {
    fetch("/api/public/survey/started", { method: "POST" }).catch(() => undefined);
  }, []);

  const answer = async (key: QKey, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1);
      return;
    }
    setPhase("loading");
    try {
      const r = await fetch("/api/public/survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await r.json()) as { ok?: boolean; id?: string; topic?: string; error?: string };
      if (!data.ok || !data.id || !data.topic) throw new Error(data.error ?? "submit failed");
      setSurveyId(data.id);
      setTopic(data.topic);
      const [cr, sr] = await Promise.all([
        fetch(`/api/public/circles?topic=${encodeURIComponent(data.topic)}`)
          .then((x) => x.json())
          .catch(() => ({ circles: [] })),
        fetch(`/api/public/specialists?topic=${encodeURIComponent(data.topic)}`)
          .then((x) => x.json())
          .catch(() => ({ specialists: [] })),
      ]);
      setCircles((cr as { circles?: Circle[] }).circles ?? []);
      setSpecialists((sr as { specialists?: SpecialistCard[] }).specialists ?? []);
      setPhase("results");
      fetch(`/api/public/survey/${encodeURIComponent(data.id)}/matches-shown`, { method: "POST" }).catch(() => undefined);
    } catch {
      // Even on failure, don't strand the visitor on a dead loading screen.
      setPhase("results");
    }
  };

  const join = () => {
    if (topic) document.cookie = `survey_topic=${encodeURIComponent(topic)}; path=/; max-age=3600`;
    if (surveyId) fetch(`/api/public/survey/${encodeURIComponent(surveyId)}/join-clicked`, { method: "POST" }).catch(() => undefined);
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05060d] px-5 py-10 text-ink">
      <section className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-line bg-[rgba(14,16,30,0.72)] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
          <Brand size={22} />

          {phase === "asking" && (
            <QuestionScreen
              index={step}
              total={QUESTIONS.length}
              question={QUESTIONS[step]}
              onAnswer={(v) => void answer(QUESTIONS[step].key, v)}
            />
          )}

          {phase === "loading" && (
            <div className="mt-8 space-y-3">
              <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
              <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
            </div>
          )}

          {phase === "results" && (
            <ResultsScreen
              need={answers.biggestNeed ? (NEED_LABEL[answers.biggestNeed] ?? "") : ""}
              circles={circles}
              specialists={specialists}
              onJoin={join}
            />
          )}
        </div>
        <p className="mt-5 text-center text-[11.5px] text-faint">5 quick questions · no account needed to answer</p>
      </section>
    </main>
  );
}

function QuestionScreen({
  index,
  total,
  question,
  onAnswer,
}: {
  index: number;
  total: number;
  question: Question;
  onAnswer: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-6 mt-6 flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= index ? "bg-gold" : "bg-[rgba(255,255,255,0.1)]"}`}
          />
        ))}
      </div>
      <h1
        className="text-[22px] font-extrabold leading-tight text-ink sm:text-[25px]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {question.title}
      </h1>
      <div className="mt-6 space-y-2.5">
        {question.options.map((o) => (
          <button
            key={o.value}
            onClick={() => onAnswer(o.value)}
            className="w-full rounded-xl border border-line bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-left text-[14.5px] font-medium text-ink transition hover:border-gold/60 hover:bg-[rgba(255,201,77,0.08)]"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultsScreen({
  need,
  circles,
  specialists,
  onJoin,
}: {
  need: string;
  circles: Circle[] | null;
  specialists: SpecialistCard[] | null;
  onJoin: () => void;
}) {
  const hasMatches = (circles && circles.length > 0) || (specialists && specialists.length > 0);
  return (
    <div className="mt-6">
      <h1
        className="text-[22px] font-extrabold leading-tight text-ink sm:text-[25px]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {hasMatches ? (
          <>
            Here&rsquo;s what your network already has{" "}
            {need && (
              <>
                for <span className="text-gold">{need}</span>
              </>
            )}
          </>
        ) : (
          "Trusty is built for exactly this"
        )}
      </h1>

      {!hasMatches && (
        <p className="mt-3 text-[14.5px] leading-relaxed text-dim">
          We don&rsquo;t have circles or experts tagged for this yet — join and be the first to find out when we do.
        </p>
      )}

      {specialists && specialists.length > 0 && (
        <div className="mt-5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">Trusted experts</div>
          <ul className="mt-2 space-y-2">
            {specialists.map((s) => (
              <li key={s.nodeId} className="rounded-xl border border-line bg-[rgba(255,255,255,0.03)] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-ink">{s.label}</span>
                  {s.verified && <span className="text-[10.5px] font-semibold text-emerald-400">Verified</span>}
                </div>
                <div className="mt-0.5 text-[12.5px] capitalize text-dim">
                  {s.nodeType.replace(/_/g, " ")} · {s.trustLabelText}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {circles && circles.length > 0 && (
        <div className="mt-5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">Circles</div>
          <ul className="mt-2 space-y-2">
            {circles.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-[rgba(255,255,255,0.03)] p-3.5">
                <div className="text-[14px] font-bold text-ink">{c.label}</div>
                {c.description && <div className="mt-0.5 text-[12.5px] text-dim">{c.description}</div>}
                <div className="mt-1 text-[11.5px] text-faint">
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <a
        href="/api/auth/login?waitlist=1&register=1"
        onClick={onJoin}
        className="mt-7 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110"
        style={{ fontFamily: "var(--font-display)", background: "linear-gradient(180deg,#ffe08a,#ffc24d)" }}
      >
        Join Trusty
      </a>
      <a href="/api/auth/login" className="mt-3 block text-center text-[13px] text-dim hover:text-ink">
        Already have an account? Sign in
      </a>
    </div>
  );
}
