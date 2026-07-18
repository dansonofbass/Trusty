"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronUp, Compass, MessageCircle, RotateCcw } from "lucide-react";
import { describeJourneyEvent, type JourneyStatus } from "@constellation/graph-core";
import {
  fetchJourney,
  fetchJourneys,
  postJourneyEvent,
  type JourneyDetail,
  type JourneySummary,
} from "@/lib/journeysClient";
import { GOLD } from "@/lib/palette";

/**
 * Decision Journeys (#35) — "users don't search, they decide". Each card is one
 * decision-in-progress: agent conversations, searches, refinements, shortlists
 * and the eventual choice all land on its timeline. Journeys start automatically
 * when the agent runs a decision-shaped search; this panel is where you resume,
 * review or close them.
 */

const STATUS_META: Record<JourneyStatus, { label: string; color: string }> = {
  open: { label: "deciding", color: "#3fc6f4" },
  decided: { label: "decided", color: "#ff8c5a" },
  completed: { label: "completed", color: "#54d26e" },
  closed: { label: "closed", color: "#8e97bd" },
};

const REC_STATE_ICON: Record<string, string> = {
  suggested: "·",
  viewed: "👁",
  saved: "☆",
  dismissed: "✕",
  selected: "✓",
};

function ContextChips({ j }: { j: JourneySummary }) {
  const c = j.context;
  const chips = [
    `#${c.topic.replace(/_/g, " ")}`,
    ...(c.geo ? [c.geo] : []),
    ...(c.budget ? [c.budget] : []),
    ...(c.language ? [c.language] : []),
    ...(c.timeline ? [c.timeline] : []),
    ...c.preferences,
    ...c.constraints,
  ];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.slice(0, 8).map((x, i) => (
        <span key={`${x}:${i}`} className="rounded-full bg-[rgba(146,166,255,0.1)] px-1.5 py-0.5 text-[9.5px] text-[var(--color-dim)]">
          {x}
        </span>
      ))}
    </div>
  );
}

export default function JourneysPanel({
  refreshKey,
  onDiscuss,
}: {
  /** Bump after agent turns — tools may have created/updated journeys. */
  refreshKey: number;
  onDiscuss: (j: JourneySummary) => void;
}) {
  const [journeys, setJourneys] = useState<JourneySummary[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JourneyDetail | null>(null);

  const load = useCallback(async () => {
    const active = await fetchJourneys("active");
    if (showClosed) {
      const closed = await fetchJourneys("closed");
      const completed = await fetchJourneys("completed");
      setJourneys([...active, ...completed, ...closed]);
    } else {
      setJourneys(active);
    }
  }, [showClosed]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void fetchJourney(openId).then(setDetail);
  }, [openId, refreshKey]);

  const setStatus = async (j: JourneySummary, kind: "closed" | "reopened") => {
    await postJourneyEvent(j.id, kind);
    await load();
    if (openId === j.id) void fetchJourney(j.id).then(setDetail);
  };

  if (!journeys.length && !showClosed) {
    return (
      <div className="mt-5 border-t border-line pt-3">
        <div className="mb-1 flex items-center gap-2">
          <Compass size={13} className="text-[var(--color-dim)]" />
          <span className="text-[12px] font-semibold text-ink">My decisions</span>
        </div>
        <p className="py-1 text-[11px] text-[var(--color-faint)]">
          Ask the agent for something decision-shaped (“I need a dentist in Berlin”) and a journey
          starts here — it remembers your context so you never repeat yourself.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-2">
        <Compass size={13} className="text-[var(--color-dim)]" />
        <span className="text-[12px] font-semibold text-ink">My decisions</span>
        <button
          type="button"
          onClick={() => setShowClosed((v) => !v)}
          className="ml-auto text-[10px] text-[var(--color-faint)] hover:text-ink"
        >
          {showClosed ? "hide finished" : "show finished"}
        </button>
      </div>
      <ul className="space-y-1.5">
        {journeys.map((j) => {
          const meta = STATUS_META[j.status];
          const expanded = openId === j.id;
          return (
            <li key={j.id} className="rounded-xl border border-[var(--color-line)] p-2.5 transition hover:border-[rgba(255,140,90,0.35)]">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpenId(expanded ? null : j.id)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium capitalize text-ink">{j.title}</span>
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: `${meta.color}22`, color: meta.color }}>
                      {meta.label}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  title="Continue this decision with the agent"
                  onClick={() => onDiscuss(j)}
                  className="shrink-0 rounded-lg border border-[rgba(255,140,90,0.4)] p-1.5 text-[10px]"
                  style={{ color: GOLD }}
                >
                  <MessageCircle size={12} />
                </button>
                <button type="button" onClick={() => setOpenId(expanded ? null : j.id)} className="shrink-0 p-1 text-[var(--color-faint)]">
                  {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
              <ContextChips j={j} />
              {expanded && detail?.id === j.id && (
                <div className="mt-2 border-t border-line/60 pt-2">
                  {Object.keys(detail.recStates).length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {detail.events
                        .filter((e) => e.detail?.nodeId && detail.recStates[e.detail.nodeId!])
                        .reduce<{ nodeId: string; label: string }[]>((acc, e) => {
                          const nodeId = e.detail!.nodeId!;
                          if (!acc.some((x) => x.nodeId === nodeId))
                            acc.push({ nodeId, label: e.detail!.label ?? nodeId });
                          return acc;
                        }, [])
                        .map(({ nodeId, label }) => (
                          <span key={nodeId} className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink">
                            {REC_STATE_ICON[detail.recStates[nodeId]] ?? "·"} {label}
                            <span className="ml-1 text-[9px] text-[var(--color-faint)]">{detail.recStates[nodeId]}</span>
                          </span>
                        ))}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {detail.events.slice(-8).map((e) => (
                      <li key={e.id} className="flex items-start gap-1.5 text-[10.5px] text-[var(--color-dim)]">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-faint)]" />
                        <span className="min-w-0 flex-1">{describeJourneyEvent(e)}</span>
                        <span className="shrink-0 text-[9px] text-[var(--color-faint)]">
                          {new Date(e.at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    {j.status === "closed" ? (
                      <button type="button" onClick={() => void setStatus(j, "reopened")} className="flex items-center gap-1 text-[10.5px] text-[var(--color-faint)] hover:text-ink">
                        <RotateCcw size={11} /> reopen
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setStatus(j, "closed")} className="flex items-center gap-1 text-[10.5px] text-[var(--color-faint)] hover:text-ink">
                        <Archive size={11} /> close journey
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
