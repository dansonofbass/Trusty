"use client";

import { useState } from "react";

import Link from "next/link";
import { Map as MapIcon, MessagesSquare, Sparkles } from "lucide-react";
import type { ThoughtExtraction } from "@constellation/graph-core";
import { AgentTrace, MarkdownLite, type ThinkStep } from "@/components/concierge/AgentTrace";
import type { TrustRec } from "@/lib/trustClient";
import { GOLD } from "@/lib/palette";
import ConfirmCard, { type PendingConfirm } from "./ConfirmCard";
import ExpertSlotsCard, { type ExpertsToolData } from "./ExpertSlotsCard";
import { useT } from "@/lib/i18n";

/**
 * The composer agent's chat transcript (#29) — Cursor/Claude style: user
 * bubbles, a live tool trace per assistant turn (reusing the concierge
 * AgentTrace), streamed markdown, confirm cards for gated actions, and rich
 * tool payloads (trust results → "show on graph").
 */

export interface AgentTraceItem {
  id: string;
  label: string;
  status: "active" | "done" | "error";
  summary?: string;
  tool?: string;
}

export interface TrustToolData {
  topic: string;
  geo?: string;
  recs: TrustRec[];
}

/** ask_forum's receipt: where the question landed, so the user can go read it. */
export interface ForumPostToolData {
  postId?: string;
  circleId: string;
  circleLabel?: string;
  title: string;
  tags: string[];
}

export interface AgentChatEntry {
  role: "user" | "assistant";
  text: string;
  trace: AgentTraceItem[];
  streaming?: boolean;
  confirm?: PendingConfirm;
  /** Latest trust_search payload in this turn — offered as a graph overlay. */
  trustData?: TrustToolData | null;
  /** extract_entities payload — offered as a "review & weave" flow (#31). */
  weaveData?: { text: string; extraction: ThoughtExtraction } | null;
  /** find_expert payload — specialists + their open times, bookable in place. */
  expertsData?: ExpertsToolData | null;
  /** ask_forum payload — a link to the thread that was just created. */
  forumData?: ForumPostToolData | null;
}

/** Human labels for tool steps in the trace. */
export const TOOL_LABEL: Record<string, string> = {
  trust_search: "Searching your trust network",
  entity_search: "Looking up your graph",
  save_note: "Saving privately",
  update_journey: "Updating your decision journey",
  record_decision: "Recording your decision",
  create_ask: "Asking your network",
  recommend: "Recommending (trust + share)",
  ask_forum: "Posting to the community",
  find_expert: "Finding bookable specialists",
  book_session: "Booking the session",
  request_listen: "Sending listen request",
  extract_entities: "Extracting entities",
};

/** Claude/ChatGPT-style reasoning presentation: while the agent works, an
 *  animated "Thinking…" header with the live step list; once the turn
 *  finishes it collapses to a one-line receipt ("Thought · used N tools")
 *  that expands on click. */
function ThinkingBlock({ steps, active }: { steps: ThinkStep[]; active: boolean }) {
  // `tr` — `t` is bound to a think-step in the callbacks below.
  const tr = useT();
  const [open, setOpen] = useState(false);
  const tools = steps.filter((t) => t.status === "done" || t.status === "error").length;
  const hasError = steps.some((t) => t.status === "error");
  if (active) {
    return (
      <div className="mb-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-tint-soft)] px-2.5 py-2">
        <div className="thinking-shimmer mb-1 text-[11.5px] font-semibold">{tr("chat.thinking")}</div>
        <AgentTrace steps={steps} accent={GOLD} />
      </div>
    );
  }
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] text-[var(--color-faint)] transition hover:text-ink"
      >
        <span style={{ color: hasError ? "#fda4af" : GOLD }}>✻</span>
        {tr(hasError ? "agent.hiccups" : "agent.thought")}
        {tools > 0 && <span>· {tr("agent.usedTools", { count: tools })}</span>}
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-tint-soft)] px-2.5 py-2">
          <AgentTrace steps={steps} accent={GOLD} />
        </div>
      )}
    </div>
  );
}

const toSteps = (trace: AgentTraceItem[]): ThinkStep[] =>
  trace.map((t) => ({ id: t.id, label: t.label, status: t.status, summary: t.summary }));

export default function AgentChat({
  entries,
  busy,
  onDecide,
  onShowOnGraph,
  onWeaveRequest,
}: {
  entries: AgentChatEntry[];
  busy: boolean;
  onDecide: (confirmId: string, approved: boolean, args?: unknown) => void;
  onShowOnGraph: (data: TrustToolData) => void;
  onWeaveRequest?: (text: string, extraction: ThoughtExtraction) => void;
}) {
  const t = useT();
  if (!entries.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {entries.map((e, i) =>
        e.role === "user" ? (
          <div key={i} dir="auto" className="ms-8 rounded-2xl rounded-tr-sm border border-line bg-[rgba(146,166,255,0.08)] px-3 py-2 text-[12.5px] leading-relaxed text-ink">
            {e.text}
          </div>
        ) : (
          <div key={i} className="me-2">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
              <Sparkles size={11} /> {t("agent.label")}
            </span>
            {e.trace.length > 0 && <ThinkingBlock steps={toSteps(e.trace)} active={!!e.streaming} />}
            {(e.text || e.streaming) && (
              <div dir="auto" className="mt-1.5 text-[12.5px] leading-relaxed text-ink">
                <MarkdownLite text={e.text} />
                {e.streaming && (
                  <span className="ms-0.5 inline-block h-3.5 w-[7px] animate-pulse align-middle" style={{ background: GOLD }} />
                )}
              </div>
            )}
            {e.trustData && e.trustData.recs.length > 0 && (
              <button
                type="button"
                onClick={() => onShowOnGraph(e.trustData!)}
                className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-[rgba(255,140,90,0.5)] bg-[rgba(255,140,90,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#ff8c5a]"
              >
                <MapIcon size={12} /> {t("agent.showTrustPaths", { count: e.trustData.recs.length })}
              </button>
            )}
            {e.weaveData && onWeaveRequest && (
              <button
                type="button"
                onClick={() => onWeaveRequest(e.weaveData!.text, e.weaveData!.extraction)}
                className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-[rgba(154,240,200,0.5)] bg-[rgba(154,240,200,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#9af0c8]"
              >
                <Sparkles size={12} /> {t("agent.reviewEntities", { count: e.weaveData.extraction.entities.length })}
              </button>
            )}
            {e.expertsData && <ExpertSlotsCard data={e.expertsData} />}
            {e.forumData?.postId && (
              <Link
                href={`/c/${encodeURIComponent(e.forumData.circleId)}/p/${encodeURIComponent(e.forumData.postId)}`}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold"
                style={{ borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                <MessagesSquare size={12} />
                <span dir="auto">{t("forumRoute.openThread", { circle: e.forumData.circleLabel ?? "" })}</span>
              </Link>
            )}
            {e.confirm && (
              <ConfirmCard
                confirm={e.confirm}
                busy={busy}
                onDecide={(approved, args) => onDecide(e.confirm!.id, approved, args)}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}
