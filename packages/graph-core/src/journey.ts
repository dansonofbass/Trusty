/**
 * Decision Journey lifecycle (#35) — pure logic.
 *
 * Users don't search, they decide. A journey is one decision-in-progress
 * (find a lawyer, choose a broker, pick a restaurant) and becomes the unit
 * that recommendations, AI conversations, saved items and outcomes hang off.
 *
 * Evidence-first, like the rest of Trusty: the append-only event log is the
 * source of truth; context, recommendation states and status are DERIVED here
 * (the store may cache the merged context per row, but events can always
 * rebuild it). No I/O, no clock — timestamps come from the caller.
 */

export type JourneyStatus = "open" | "decided" | "completed" | "closed";

/** Structured, continuously-refined context — the journey's working memory. */
export interface JourneyContext {
  /** Canonical taxonomy topic (validated by the caller). */
  topic: string;
  /** What the user is actually trying to achieve, in their words. */
  goal?: string;
  geo?: string;
  budget?: string;
  language?: string;
  timeline?: string;
  preferences: string[];
  constraints: string[];
}

export type JourneyEventKind =
  | "created"
  | "context" // detail.patch: Partial<JourneyContext> — a refinement
  | "search" // detail.query/topic/geo/count — a trust search ran under this journey
  | "conversation" // detail.text — a notable agent exchange
  | "note"
  | "rec_suggested"
  | "rec_viewed"
  | "rec_saved"
  | "rec_dismissed"
  | "rec_selected" // detail.nodeId/label — the intended decision
  | "decided"
  | "completed"
  | "outcome" // detail.value/text
  | "reopened"
  | "closed";

export interface JourneyEvent {
  kind: JourneyEventKind;
  at: number;
  detail?: {
    patch?: Partial<JourneyContext>;
    query?: string;
    topic?: string;
    geo?: string;
    count?: number;
    nodeId?: string;
    label?: string;
    text?: string;
    value?: number;
  };
}

/** Per-recommendation state inside a journey (belongs to the journey, not the rec). */
export type JourneyRecState =
  | "suggested"
  | "viewed"
  | "saved"
  | "dismissed"
  | "selected";

const REC_EVENT_STATE: Partial<Record<JourneyEventKind, JourneyRecState>> = {
  rec_suggested: "suggested",
  rec_viewed: "viewed",
  rec_saved: "saved",
  rec_dismissed: "dismissed",
  rec_selected: "selected",
};

const dedupCap = (xs: string[], cap = 12): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = x.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
      if (out.length >= cap) break;
    }
  }
  return out;
};

/** Merge a refinement into context — strings overwrite when non-empty, list
 *  fields union (deduped, capped). Refinement never restarts the journey. */
export function mergeJourneyContext(
  base: JourneyContext,
  patch: Partial<JourneyContext>,
): JourneyContext {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    topic: str(patch.topic) ?? base.topic,
    goal: str(patch.goal) ?? base.goal,
    geo: str(patch.geo) ?? base.geo,
    budget: str(patch.budget) ?? base.budget,
    language: str(patch.language) ?? base.language,
    timeline: str(patch.timeline) ?? base.timeline,
    preferences: dedupCap([...base.preferences, ...list(patch.preferences)]),
    constraints: dedupCap([...base.constraints, ...list(patch.constraints)]),
  };
}

/** Rebuild the merged context from the event log (row cache verifier). */
export function contextFromEvents(
  initial: JourneyContext,
  events: JourneyEvent[],
): JourneyContext {
  let ctx = initial;
  for (const e of events) {
    if (e.kind === "context" && e.detail?.patch) ctx = mergeJourneyContext(ctx, e.detail.patch);
  }
  return ctx;
}

/** Current per-recommendation states — last event wins per node. */
export function deriveRecStates(events: JourneyEvent[]): Map<string, JourneyRecState> {
  const out = new Map<string, JourneyRecState>();
  for (const e of events) {
    const state = REC_EVENT_STATE[e.kind];
    if (state && e.detail?.nodeId) out.set(e.detail.nodeId, state);
  }
  return out;
}

/** Journey status from the lifecycle events — later events win; reopen → open. */
export function deriveJourneyStatus(events: JourneyEvent[]): JourneyStatus {
  let status: JourneyStatus = "open";
  for (const e of events) {
    if (e.kind === "decided" || e.kind === "rec_selected") status = "decided";
    else if (e.kind === "completed" || e.kind === "outcome") status = "completed";
    else if (e.kind === "closed") status = "closed";
    else if (e.kind === "reopened" || e.kind === "created") status = "open";
  }
  return status;
}

/** Should a new decision-shaped interaction CONTINUE this journey instead of
 *  starting a new one? Same topic, and geo only separates when both name one. */
export function journeyMatches(
  ctx: JourneyContext,
  topic: string,
  geo?: string,
): boolean {
  if (ctx.topic !== topic) return false;
  if (geo && ctx.geo && geo.trim().toLowerCase() !== ctx.geo.trim().toLowerCase()) return false;
  return true;
}

/** Human one-liner for the timeline (UI and agent summaries share it). */
export function describeJourneyEvent(e: JourneyEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "created":
      return "Journey started";
    case "context": {
      const p = d.patch ?? {};
      const bits = Object.entries(p)
        .filter(([, v]) => (Array.isArray(v) ? v.length : v))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      return bits.length ? `Refined — ${bits.join(" · ")}` : "Context refined";
    }
    case "search":
      return `Searched ${d.topic ?? d.query ?? ""}${d.geo ? ` in ${d.geo}` : ""} — ${d.count ?? 0} trusted ${d.count === 1 ? "path" : "paths"}`;
    case "conversation":
      return d.text ? `Discussed: ${d.text}` : "Talked it through with the agent";
    case "note":
      return d.text ? `Note: ${d.text}` : "Note added";
    case "rec_suggested":
      return `Suggested ${d.label ?? d.nodeId}`;
    case "rec_viewed":
      return `Viewed ${d.label ?? d.nodeId}`;
    case "rec_saved":
      return `Saved ${d.label ?? d.nodeId}`;
    case "rec_dismissed":
      return `Dismissed ${d.label ?? d.nodeId}`;
    case "rec_selected":
      return `Chose ${d.label ?? d.nodeId}`;
    case "decided":
      return "Decision made";
    case "completed":
      return "Decision carried out";
    case "outcome":
      return `Outcome ${typeof d.value === "number" ? (d.value >= 0 ? "👍" : "👎") : ""}${d.text ? ` — ${d.text}` : ""}`;
    case "reopened":
      return "Journey reopened";
    case "closed":
      return "Journey closed";
    default:
      return e.kind;
  }
}

/** Compact journey summary for the agent's <context> block — the journey IS the
 *  conversation's working memory, so users never repeat themselves (#35). */
export function summarizeJourneyForAgent(j: {
  id: string;
  title: string;
  status: JourneyStatus;
  context: JourneyContext;
  events: JourneyEvent[];
}): string {
  const c = j.context;
  const parts = [
    `journey ${j.id} "${j.title}" (${j.status}) topic=${c.topic}`,
    c.geo ? `geo=${c.geo}` : "",
    c.budget ? `budget=${c.budget}` : "",
    c.language ? `language=${c.language}` : "",
    c.timeline ? `timeline=${c.timeline}` : "",
    c.preferences.length ? `preferences=${c.preferences.join("|")}` : "",
    c.constraints.length ? `constraints=${c.constraints.join("|")}` : "",
    c.goal ? `goal="${c.goal}"` : "",
  ].filter(Boolean);
  const recs = deriveRecStates(j.events);
  const recBits: string[] = [];
  for (const [nodeId, state] of recs) {
    const label =
      [...j.events].reverse().find((e) => e.detail?.nodeId === nodeId && e.detail.label)?.detail
        ?.label ?? nodeId;
    recBits.push(`${label}(${nodeId}):${state}`);
  }
  if (recBits.length) parts.push(`recs=${recBits.slice(0, 8).join(", ")}`);
  return parts.join("; ");
}
