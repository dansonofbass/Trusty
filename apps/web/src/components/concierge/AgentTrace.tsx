"use client";

/**
 * Shared concierge primitives — the Cursor/Claude-style agent "thinking" trace
 * and a tiny safe Markdown renderer. Used by both the Sevan directory search and
 * the main-app Trust Search so the two surfaces stay identical.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight, Check, Loader2, AlertCircle } from "lucide-react";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface ThinkStep {
  id: string;
  label: string;
  status: StepStatus;
  /** Short result line shown after the label (e.g. "5 startups"). */
  summary?: string;
  /** Small leading icon for the step. */
  icon?: ReactNode;
  /** Expandable detail — revealed by the chevron once the step is done. */
  detail?: ReactNode;
}

/** The stepped trace. Each row reveals with a staggered fade (.trace-in). */
export function AgentTrace({ steps, accent = "#ff8c5a" }: { steps: ThinkStep[]; accent?: string }) {
  return (
    <div className="space-y-0.5">
      {steps.map((s, i) => (
        <div key={s.id} className="trace-in" style={{ animationDelay: `${i * 70}ms` }}>
          <StepRow step={s} accent={accent} />
        </div>
      ))}
    </div>
  );
}

function StepRow({ step, accent }: { step: ThinkStep; accent: string }) {
  const [open, setOpen] = useState(false);
  const canToggle = !!step.detail && step.status === "done";
  return (
    <div>
      <button type="button" disabled={!canToggle} onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left ${canToggle ? "hover:bg-white/[0.05]" : ""}`}>
        <span className="grid h-5 w-5 shrink-0 place-items-center">
          {step.status === "active" ? <Loader2 size={13} className="animate-spin" style={{ color: accent }} />
            : step.status === "done" ? <Check size={13} className="text-emerald-300" />
            : step.status === "error" ? <AlertCircle size={13} className="text-rose-300" />
            : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
        </span>
        {step.icon && <span className={step.status === "pending" ? "text-faint" : "text-dim"}>{step.icon}</span>}
        <span className={`flex-1 truncate text-[12.5px] ${step.status === "pending" ? "text-faint" : "text-ink"}`}>
          {step.label}
          {step.summary && <span className="ml-1.5 text-dim">· {step.summary}</span>}
        </span>
        {canToggle && <ChevronRight size={14} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />}
      </button>
      {open && step.detail && <div className="px-8 pb-2 pt-0.5">{step.detail}</div>}
    </div>
  );
}

/* ----------------------------- Markdown ---------------------------- */

/** Inline Markdown: **bold** and *italic* / _italic_ → real elements (safe, no HTML). */
export function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const bold = m[2] ?? m[3];
    if (bold != null) out.push(<strong key={`${keyBase}${i}`} className="font-semibold text-ink">{bold}</strong>);
    else out.push(<em key={`${keyBase}${i}`}>{m[4] ?? m[5]}</em>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal Markdown block renderer — paragraphs + `- ` bullet lists. */
export function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    const key = `ul${blocks.length}`;
    blocks.push(
      <ul key={key} className="my-1 list-disc space-y-0.5 pl-4 marker:text-[#ff8c5a]">
        {items.map((li, i) => <li key={i}>{renderInline(li, `${key}-${i}-`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bul = line.match(/^\s*[-*]\s+(.*)$/);
    if (bul) { bullets.push(bul[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`} className="mb-1.5 last:mb-0">{renderInline(line, `p${blocks.length}-`)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
