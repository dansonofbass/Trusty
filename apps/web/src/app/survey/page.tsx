"use client";

import { useEffect, useState } from "react";
import Brand from "@/components/Brand";
import QuestionScreen from "@/components/survey/QuestionScreen";
import { NEED_LABEL, SURVEY_QUESTIONS, submitSurvey, type QKey } from "@/lib/surveyQuestions";
import { SPECIALIST_TYPE_FA, TRUST_LABEL_FA } from "@/lib/specialistClient";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";

/**
 * Public market-test survey (no login — excluded from the proxy gate, see
 * proxy.ts). Five 4-option questions about relocation needs + willingness to
 * pay, then a results screen backed by REAL circles and admin-tagged, trust-
 * ranked specialists for the stated need — not a mockup. The CTA funnels into
 * the existing invite/waitlist auth flow; nothing about that flow changes.
 *
 * The same 5 questions also appear inside onboarding (see
 * apps/web/src/app/onboarding/page.tsx) for anyone who registers WITHOUT
 * coming through this page first, so the market test isn't limited to people
 * who specifically clicked the /survey link.
 *
 * Copy is Persian throughout (see surveyQuestions.ts for why) — the results
 * screen and CTA are written the same way, not just the questions.
 */

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
  photoUrl?: string;
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
    if (step + 1 < SURVEY_QUESTIONS.length) {
      setStep(step + 1);
      return;
    }
    setPhase("loading");
    try {
      const data = await submitSurvey(next as Record<QKey, string>);
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
              total={SURVEY_QUESTIONS.length}
              question={SURVEY_QUESTIONS[step]}
              onAnswer={(v) => void answer(SURVEY_QUESTIONS[step].key, v)}
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
        <p dir="rtl" lang="fa" className="mt-5 text-center text-[11.5px] text-faint">
          ۵ تا سوال سریع · نیازی به حساب کاربری نیست
        </p>
      </section>
    </main>
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
    <div dir="rtl" lang="fa" className="mt-6">
      <h1
        className="text-right text-[22px] font-extrabold leading-relaxed text-ink sm:text-[25px]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {hasMatches ? (
          <>
            اینا چیزاییه که همین الان تو Trusty{" "}
            {need && (
              <>
                برای <span className="text-gold">{need}</span>
              </>
            )}{" "}
            داریم
          </>
        ) : (
          "Trusty دقیقاً برای همینا ساخته شده"
        )}
      </h1>

      {!hasMatches && (
        <p className="mt-3 text-right text-[14.5px] leading-relaxed text-dim">
          هنوز براش گروه یا متخصصی ثبت نکردیم — بپیوند تا اولین نفری باشی که خبردار می‌شه وقتی داشتیم.
        </p>
      )}

      {specialists && specialists.length > 0 && (
        <div className="mt-5">
          <div className="text-right text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
            متخصص‌های قابل‌اعتماد
          </div>
          <ul className="mt-2 space-y-2">
            {specialists.map((s) => (
              <li key={s.nodeId} className="flex items-center gap-3 rounded-xl border border-line bg-[rgba(255,255,255,0.03)] p-3.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between">
                    {s.verified && <span className="text-[10.5px] font-semibold text-emerald-400">تایید شده</span>}
                    <span className="text-[14px] font-bold text-ink">{s.label}</span>
                  </span>
                  <span className="mt-0.5 block text-right text-[12.5px] text-dim">
                    {SPECIALIST_TYPE_FA[s.nodeType] ?? s.nodeType} · {TRUST_LABEL_FA[s.trustLabel] ?? s.trustLabelText}
                  </span>
                </span>
                <SpecialistAvatar label={s.label} photoUrl={s.photoUrl} size={34} rounded="rounded-lg" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {circles && circles.length > 0 && (
        <div className="mt-5">
          <div className="text-right text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">گروه‌ها</div>
          <ul className="mt-2 space-y-2">
            {circles.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-[rgba(255,255,255,0.03)] p-3.5">
                <div className="text-right text-[14px] font-bold text-ink">{c.label}</div>
                {c.description && <div className="mt-0.5 text-right text-[12.5px] text-dim">{c.description}</div>}
                <div className="mt-1 text-right text-[11.5px] text-faint">{c.memberCount} عضو</div>
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
        بپیوند به Trusty
      </a>
      <a href="/api/auth/login" className="mt-3 block text-center text-[13px] text-dim hover:text-ink">
        قبلاً حساب داری؟ وارد شو
      </a>
    </div>
  );
}
