/**
 * Decision Journeys client (#35) — same-origin BFF, session-authed.
 */
import type {
  JourneyContext,
  JourneyEvent,
  JourneyEventKind,
  JourneyRecState,
  JourneyStatus,
} from "@constellation/graph-core";

export interface JourneySummary {
  id: string;
  title: string;
  status: JourneyStatus;
  context: JourneyContext;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyDetail extends JourneySummary {
  events: (JourneyEvent & { id: string })[];
  recStates: Record<string, JourneyRecState>;
}

export async function fetchJourneys(
  status: JourneyStatus | "active" = "active",
): Promise<JourneySummary[]> {
  const r = await fetch(`/api/journeys?status=${status}`);
  if (!r.ok) return [];
  return (await r.json()) as JourneySummary[];
}

export async function fetchJourney(id: string): Promise<JourneyDetail | null> {
  const r = await fetch(`/api/journeys/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  return (await r.json()) as JourneyDetail;
}

export async function postJourneyEvent(
  id: string,
  kind: JourneyEventKind,
  detail?: JourneyEvent["detail"],
): Promise<JourneySummary | null> {
  const r = await fetch(`/api/journeys/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, detail }),
  });
  if (!r.ok) return null;
  return (await r.json()) as JourneySummary;
}
