"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";
import {
  completeOnboarding,
  getFirstRec,
  getOnboarding,
  saveStep,
  type FirstRec,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboardingClient";
import QuestionScreen from "@/components/survey/QuestionScreen";
import { SURVEY_QUESTIONS, submitSurvey, type QKey } from "@/lib/surveyQuestions";

/**
 * Progressive onboarding — one question per screen, under a minute, ending in a
 * real recommendation drawn from the inviter's network (the aha-moment). No
 * trust actions, no graph editing, no jargon (spec #4). Every step persists to
 * the server so it resumes across devices / reloads.
 */

const TOPIC_LABEL: Record<string, string> = {
  food: "Food",
  restaurant: "Restaurants",
  cafe: "Cafés",
  doctor: "Doctors",
  dentist: "Dentists",
  lawyer: "Lawyers",
  broker: "Real-estate brokers",
  real_estate: "Housing & rentals",
  immigration: "Immigration",
  mechanic: "Mechanics",
  electrician: "Electricians",
  plumber: "Plumbers",
  accountant: "Accountants",
  shopping: "Shopping",
  travel: "Travel",
  fitness: "Fitness",
  technology: "Technology",
  music: "Music",
  entertainment: "Entertainment",
};

const label = (t: string) => TOPIC_LABEL[t] ?? t.replace(/_/g, " ");

/** Reads (and clears) the short-lived `survey_topic` cookie set by /survey's
 *  "Join Trusty" CTA — a one-shot continuity handoff, not persistent state. */
function consumeSurveyTopicCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)survey_topic=([^;]+)/);
  if (!match) return null;
  document.cookie = "survey_topic=; path=/; max-age=0";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

const ORDER: OnboardingStep[] = ["welcome", "topics", "looking_for", "profile", "first_rec"];

export default function OnboardingPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [topics, setTopics] = useState<string[]>([]);
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("");

  // Market-test survey fallback: anyone who registers WITHOUT having gone
  // through the public /survey page first (e.g. a direct invite link) still
  // gets asked the same 5 questions, so the market test covers every new
  // user, not just people who clicked the /survey link specifically.
  const [needsSurveyFallback, setNeedsSurveyFallback] = useState(false);
  const [showingSurvey, setShowingSurvey] = useState(false);
  const [surveyStep, setSurveyStep] = useState(0);
  const [surveyAnswers, setSurveyAnswers] = useState<Partial<Record<QKey, string>>>({});
  const [surveySubmitting, setSurveySubmitting] = useState(false);

  // Resume from server state on mount.
  useEffect(() => {
    getOnboarding()
      .then((s: OnboardingState) => {
        if (s.completed) {
          router.replace("/");
          return;
        }
        // The public market-test survey (/survey) already asked "what's your
        // biggest need" before signup; if that answer mapped to a known topic,
        // pre-select it here so the same question is never asked twice.
        const surveyTopic = consumeSurveyTopicCookie();
        const topics0 = s.topics?.length ? s.topics : surveyTopic && TOPIC_TAXONOMY.includes(surveyTopic) ? [surveyTopic] : [];
        setTopics(topics0);
        setLookingFor(s.lookingFor ?? []);
        setName(s.profile?.name ?? "");
        setCity(s.profile?.city ?? "");
        setLanguage(s.profile?.language ?? "");
        const resumeStep = s.step && s.step !== "done" ? s.step : "welcome";
        setStep(resumeStep);
        // Only offer the fallback survey at the very start of a fresh session
        // (no cookie handoff, nothing answered yet, nothing saved past welcome).
        if (!surveyTopic && !topics0.length && resumeStep === "welcome") setNeedsSurveyFallback(true);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [router]);

  const go = async (next: OnboardingStep, patch?: Parameters<typeof saveStep>[0]) => {
    setStep(next);
    try {
      await saveStep({ step: next, ...patch });
    } catch {
      /* persistence is best-effort; local state still advances */
    }
  };

  const answerSurvey = async (key: QKey, value: string) => {
    const nextAnswers = { ...surveyAnswers, [key]: value };
    setSurveyAnswers(nextAnswers);
    if (surveyStep + 1 < SURVEY_QUESTIONS.length) {
      setSurveyStep(surveyStep + 1);
      return;
    }
    setSurveySubmitting(true);
    try {
      const data = await submitSurvey(nextAnswers as Record<QKey, string>);
      if (data.ok && data.topic && TOPIC_TAXONOMY.includes(data.topic)) {
        setTopics((t) => (t.length ? t : [data.topic as string]));
      }
    } catch {
      /* best-effort — still let them continue onboarding either way */
    } finally {
      setShowingSurvey(false);
      setSurveySubmitting(false);
      void go("topics");
    }
  };

  if (!loaded) return <Shell>{null}</Shell>;

  return (
    <Shell>
      {!showingSurvey && <Progress step={step} />}

      {showingSurvey && (
        surveySubmitting ? (
          <div className="mt-8 space-y-3">
            <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
            <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
          </div>
        ) : (
          <QuestionScreen
            index={surveyStep}
            total={SURVEY_QUESTIONS.length}
            question={SURVEY_QUESTIONS[surveyStep]}
            onAnswer={(v) => void answerSurvey(SURVEY_QUESTIONS[surveyStep].key, v)}
          />
        )
      )}

      {step === "welcome" && !showingSurvey && (
        <Step
          title={<>Find who your network <span className="text-gold">actually trusts</span></>}
          body="Trusty helps you make better decisions — the dentist, lawyer, or mechanic people you trust rely on, with the reason shown."
          cta="Get started"
          onNext={() => (needsSurveyFallback ? setShowingSurvey(true) : go("topics"))}
        />
      )}

      {step === "topics" && (
        <Step
          title={<>What do you <span className="text-gold">know</span> about?</>}
          body="Pick a few areas you have real experience with. This shapes what we can recommend — it doesn't create anything public."
          cta="Continue"
          disabled={topics.length === 0}
          onNext={() => go("looking_for", { topics })}
        >
          <Chips options={TOPIC_TAXONOMY} selected={topics} onToggle={(t) =>
            setTopics((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))
          } />
        </Step>
      )}

      {step === "looking_for" && (
        <Step
          title={<>What are you <span className="text-gold">looking for</span> now?</>}
          body="Pick what you need most right now. We'll use it to show your first recommendation."
          cta="Continue"
          disabled={lookingFor.length === 0}
          onNext={() => go("profile", { lookingFor })}
          onBack={() => go("topics")}
        >
          <Chips
            options={TOPIC_TAXONOMY}
            selected={lookingFor}
            onToggle={(t) =>
              setLookingFor((s) => (s.includes(t) ? s.filter((x) => x !== t) : [t, ...s.filter((x) => x !== t)].slice(0, 3)))
            }
          />
        </Step>
      )}

      {step === "profile" && (
        <Step
          title={<>A little <span className="text-gold">about you</span></>}
          body="Just enough to personalize your recommendations."
          cta="See my first recommendation"
          disabled={!name.trim()}
          onNext={() => go("first_rec", { profile: { name, city, language } })}
          onBack={() => go("looking_for")}
        >
          <Field label="Name" value={name} onChange={setName} placeholder="Your name" />
          <Field label="City" value={city} onChange={setCity} placeholder="Where you're based" />
          <Field label="Preferred language" value={language} onChange={setLanguage} placeholder="e.g. English" />
        </Step>
      )}

      {step === "first_rec" && (
        <FirstRecommendation
          topic={lookingFor[0] ?? topics[0] ?? ""}
          onEnter={async () => {
            try {
              await completeOnboarding();
            } catch {
              /* even if the write hiccups, let them in — status flips server-side */
            }
            router.replace("/");
          }}
        />
      )}
    </Shell>
  );
}

/* --------------------------------- pieces -------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05060d] px-5 py-10 text-ink">
      <section className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-line bg-[rgba(14,16,30,0.72)] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
          {children}
        </div>
      </section>
    </main>
  );
}

function Progress({ step }: { step: OnboardingStep }) {
  const idx = Math.max(0, ORDER.indexOf(step));
  return (
    <div className="mb-6 flex gap-1.5">
      {ORDER.map((s, i) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? "bg-gold" : "bg-[rgba(255,255,255,0.1)]"}`}
        />
      ))}
    </div>
  );
}

function Step({
  title,
  body,
  cta,
  onNext,
  onBack,
  disabled,
  children,
}: {
  title: React.ReactNode;
  body: string;
  cta: string;
  onNext: () => void;
  onBack?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-[24px] font-extrabold leading-tight text-ink sm:text-[27px]" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-dim">{body}</p>
      {children && <div className="mt-5">{children}</div>}
      <button
        onClick={onNext}
        disabled={disabled}
        className="mt-7 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110 disabled:opacity-50"
        style={{ fontFamily: "var(--font-display)", background: "linear-gradient(180deg,#ffe08a,#ffc24d)" }}
      >
        {cta}
      </button>
      {onBack && (
        <button onClick={onBack} className="mt-3 block w-full text-center text-[13px] text-dim hover:text-ink">
          Back
        </button>
      )}
    </div>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((t) => {
        const on = selected.includes(t);
        return (
          <button
            key={t}
            onClick={() => onToggle(t)}
            className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
              on ? "border-gold bg-[rgba(255,201,77,0.14)] text-ink" : "border-line text-dim hover:border-gold/60"
            }`}
          >
            {label(t)}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-3">
      <label className="block text-[12px] font-medium uppercase tracking-[0.14em] text-faint">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-line bg-[rgba(255,255,255,0.04)] px-4 py-3 text-[15px] text-ink outline-none focus:border-gold"
      />
    </div>
  );
}

function FirstRecommendation({ topic, onEnter }: { topic: string; onEnter: () => void }) {
  const [recs, setRecs] = useState<FirstRec[] | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | undefined>();
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (!topic) {
      setRecs([]);
      return;
    }
    getFirstRec(topic)
      .then((r) => {
        setRecs(r.recommendations);
        setSeededFrom(r.seededFrom);
      })
      .catch(() => setRecs([]));
  }, [topic]);

  const heading = useMemo(() => {
    if (recs === null) return "Finding your first recommendation…";
    if (recs.length === 0) return "Your network is ready";
    return "Your first recommendation ✦";
  }, [recs]);

  const enter = () => {
    setEntering(true);
    onEnter();
  };

  return (
    <div>
      <h1 className="text-[24px] font-extrabold leading-tight text-ink sm:text-[27px]" style={{ fontFamily: "var(--font-display)" }}>
        {heading}
      </h1>

      {recs === null && (
        <div className="mt-6 space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
          <div className="h-16 animate-pulse rounded-xl bg-[rgba(255,255,255,0.05)]" />
        </div>
      )}

      {recs && recs.length > 0 && (
        <>
          <p className="mt-2 text-[14px] text-dim">
            From {seededFrom ?? "your network"}, for <b className="text-ink">{topic.replace(/_/g, " ")}</b>.
          </p>
          <ul className="mt-5 space-y-3">
            {recs.map((r) => (
              <li key={r.nodeId} className="rounded-xl border border-line bg-[rgba(255,255,255,0.03)] p-4">
                <div className="text-[15px] font-bold text-ink">{r.label}</div>
                {r.reason && <div className="mt-1 text-[13px] leading-relaxed text-dim">{r.reason}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {recs && recs.length === 0 && (
        <p className="mt-3 text-[15px] leading-relaxed text-dim">
          You're all set. Search any time for who your network trusts — and vouch
          for people you rely on so your taste helps them back.
        </p>
      )}

      <button
        onClick={enter}
        disabled={entering || recs === null}
        className="mt-7 flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-[15px] font-bold text-[#05060d] transition hover:brightness-110 disabled:opacity-60"
        style={{ fontFamily: "var(--font-display)", background: "linear-gradient(180deg,#ffe08a,#ffc24d)" }}
      >
        {entering ? "Entering…" : "Enter Trusty"}
      </button>
    </div>
  );
}
