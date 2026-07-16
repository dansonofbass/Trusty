"use client";

import { Map as MapIcon, Sparkles } from "lucide-react";
import type { ThoughtExtraction } from "@constellation/graph-core";
import { AgentTrace, MarkdownLite, type ThinkStep } from "@/components/concierge/AgentTrace";
import type { TrustRec } from "@/lib/trustClient";
import { GOLD } from "@/lib/palette";
import ConfirmCard, { type PendingConfirm } from "./ConfirmCard";

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
}

/** Human labels for tool steps in the trace. */
export const TOOL_LABEL: Record<string, string> = {
  trust_search: "Searching your trust network",
  entity_search: "Looking up your graph",
  save_note: "Saving privately",
  create_ask: "Asking your network",
  publish_recommendation: "Publishing recommendation",
  add_trust: "Recording trust",
  request_listen: "Sending listen request",
  extract_entities: "Extracting entities",
};

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
  if (!entries.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {entries.map((e, i) =>
        e.role === "user" ? (
          <div key={i} className="ml-8 rounded-2xl rounded-tr-sm border border-line bg-[rgba(146,166,255,0.08)] px-3 py-2 text-[12.5px] leading-relaxed text-ink">
            {e.text}
          </div>
        ) : (
          <div key={i} className="mr-2">
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
              <Sparkles size={11} /> Agent
            </span>
            {e.trace.length > 0 && <AgentTrace steps={toSteps(e.trace)} accent={GOLD} />}
            {(e.text || e.streaming) && (
              <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink">
                <MarkdownLite text={e.text} />
                {e.streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse align-middle" style={{ background: GOLD }} />
                )}
              </div>
            )}
            {e.trustData && e.trustData.recs.length > 0 && (
              <button
                type="button"
                onClick={() => onShowOnGraph(e.trustData!)}
                className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-[rgba(255,140,90,0.5)] bg-[rgba(255,140,90,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#ff8c5a]"
              >
                <MapIcon size={12} /> Show {e.trustData.recs.length} trust path{e.trustData.recs.length === 1 ? "" : "s"} on the graph
              </button>
            )}
            {e.weaveData && onWeaveRequest && (
              <button
                type="button"
                onClick={() => onWeaveRequest(e.weaveData!.text, e.weaveData!.extraction)}
                className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-[rgba(154,240,200,0.5)] bg-[rgba(154,240,200,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#9af0c8]"
              >
                <Sparkles size={12} /> Review {e.weaveData.extraction.entities.length} entities &amp; weave into your sky
              </button>
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
