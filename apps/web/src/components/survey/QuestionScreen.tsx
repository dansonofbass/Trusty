import type { SurveyQuestion } from "@/lib/surveyQuestions";

/** One market-test question, one screen — shared visual between the public
 *  /survey flow and the in-onboarding fallback. */
export default function QuestionScreen({
  index,
  total,
  question,
  onAnswer,
}: {
  index: number;
  total: number;
  question: SurveyQuestion;
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
