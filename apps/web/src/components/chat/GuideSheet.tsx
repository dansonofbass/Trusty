"use client";

/**
 * The "what can I ask?" guide — a command catalog for the agent, grouped by
 * what people are trying to do. Every example is runnable: tap → the prompt
 * fires as a real turn. Opened from the hero ("Everything you can ask").
 */
import { createPortal } from "react-dom";
import { X, Tent, Search, NotebookPen, Scale, Megaphone } from "lucide-react";

/** Plain-language framing shown at the top: the three things this app does. */
const THREE_JOBS = [
  { emoji: "💬", text: "Ask — one input; the agent searches your community's saved answers and your trusted network before anything generic." },
  { emoji: "⭕", text: "Message your circles — group chats where good answers get bookmarked and become shared memory." },
  { emoji: "🤝", text: "Find people you can trust — every recommendation comes with WHO vouches for it and why." },
];

const SECTIONS: { icon: React.ReactNode; title: string; blurb: string; prompts: string[] }[] = [
  {
    icon: <Tent size={14} />,
    title: "Seaside Startup Summit",
    blurb: "Type /summit (or just mention the summit) and the agent becomes your event concierge.",
    prompts: [
      "/summit set me up",
      "/summit who should I meet?",
      "/summit what's on the agenda today?",
      "/summit who's in my squad?",
      "/summit confirm Ani is in my squad",
      "/summit notes from my mentor session with Chris Burry: …",
    ],
  },
  {
    icon: <Search size={14} />,
    title: "Find someone you can trust",
    blurb: "Trust search walks your network — every result comes with its because-path.",
    prompts: [
      "Find a trusted dentist in Yerevan",
      "Who do my friends trust for immigration law?",
      "I need a plumber in Gyumri urgently",
    ],
  },
  {
    icon: <NotebookPen size={14} />,
    title: "Remember & connect knowledge",
    blurb: "Notes are private; [[links]], @people and #topics wire them into your graph.",
    prompts: [
      "Save a note: met Sara at the pitch night, she needs a designer",
      "What did I write about Yerevan restaurants?",
    ],
  },
  {
    icon: <Scale size={14} />,
    title: "Decide something big",
    blurb: "Decisions get a journey: context, candidates, and a follow-up on the outcome.",
    prompts: [
      "Help me choose between the two lawyers I shortlisted",
      "What's the status of my apartment decision?",
    ],
  },
  {
    icon: <Megaphone size={14} />,
    title: "Ask your network",
    blurb: "When search comes up empty, broadcast the need to people who listen to you.",
    prompts: [
      "Ask my network for a good accountant",
      "Recommend Sara as a designer to my circle",
    ],
  },
];

export default function GuideSheet({ onRun, onClose }: {
  onRun: (prompt: string) => void;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel flex max-h-[86dvh] w-full max-w-lg flex-col rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="What you can ask"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <span className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Everything you can ask
          </span>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* The whole app in three sentences — de-jargoned. */}
          <div className="space-y-1.5">
            {THREE_JOBS.map((j) => (
              <p key={j.emoji} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--color-dim)]">
                <span>{j.emoji}</span>
                <span>{j.text}</span>
              </p>
            ))}
          </div>
          <p className="rounded-lg bg-[var(--color-tint)] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-dim)]">
            Tip: type <b className="text-ink">/</b> in the message box to switch skills — <b className="text-ink">/summit</b>,{" "}
            <b className="text-ink">/find</b>, <b className="text-ink">/note</b>, <b className="text-ink">/decide</b>, <b className="text-ink">/ask</b>.
          </p>
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
                <span style={{ color: "var(--color-accent)" }}>{s.icon}</span> {s.title}
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-faint)]">{s.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.prompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      onRun(p);
                      onClose();
                    }}
                    className="rounded-lg border border-[var(--color-line)] bg-[var(--color-tint-soft)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-dim)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
