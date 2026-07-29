"use client";

/**
 * The "what can I ask?" guide — a command catalog for the agent, grouped by
 * what people are trying to do. Every example is runnable: tap → the prompt
 * fires as a real turn. Opened from the hero ("Everything you can ask").
 */
import { createPortal } from "react-dom";
import { X, Tent, Search, NotebookPen, Scale, Megaphone } from "lucide-react";

const SECTIONS: { icon: React.ReactNode; title: string; blurb: string; prompts: string[] }[] = [
  {
    icon: <Tent size={14} />,
    title: "Seaside Startup Summit",
    blurb: "Mention @seasidestartupsummit and the agent becomes your event concierge.",
    prompts: [
      "@seasidestartupsummit set me up",
      "@seasidestartupsummit who should I meet?",
      "@seasidestartupsummit what's on the agenda today?",
      "@seasidestartupsummit who's in my squad?",
      "@seasidestartupsummit confirm Ani is in my squad",
      "@seasidestartupsummit notes from my mentor session with Chris Burry: …",
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
