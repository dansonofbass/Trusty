/**
 * Domain events (#48/#50 seed, #52 analytics) — the complete taxonomy of
 * meaningful actions in Trusty, as flat Kibana-friendly envelopes.
 *
 * Rules:
 * - `domain.action`, past tense, one event per user-meaningful mutation.
 * - Payloads carry ids / counts / enum states ONLY — never note bodies, doc
 *   text, feedback text, or chat content (privacy by construction).
 * - The union is closed on purpose: adding a type here is a reviewed act.
 */

export const DOMAIN_EVENT_TYPES = [
  // auth / session (web BFF + graph-service chokepoint)
  "auth.login_started",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "user.provisioned",
  "access.status_changed",
  // invites / waitlist / onboarding
  "invite.created",
  "invite.visited",
  "invite.accepted",
  "waitlist.joined",
  "waitlist.approved",
  "onboarding.step_saved",
  "onboarding.completed",
  // graph / sky
  "edge.added",
  "edge.removed",
  "post.created",
  "thought.ingested",
  "entity.created",
  "entity_link.added",
  "entity_link.removed",
  "profile.updated",
  // search / discovery
  "search.performed",
  "who_to_meet.queried",
  // recommendations
  "rec.suggestion_accepted",
  "rec.suggestion_dismissed",
  "rec.published",
  "rec.outcome_attached",
  // trust
  "trust.added",
  "trust.removed",
  "trust.outcome_recorded",
  // intent / outcomes
  "intent.marked",
  "outcome.resolved",
  // journeys
  "journey.created",
  "journey.continued",
  "journey.event_appended",
  // chat / agent
  "conversation.created",
  "conversation.turns_saved",
  "conversation.renamed",
  "conversation.deleted",
  "agent.turn_started",
  "agent.tool_called",
  "agent.turn_completed",
  "agent.confirm_decided",
  // docs / workspace
  "doc.draft_saved",
  "doc.updated",
  "doc.deleted",
  "doc.moved",
  "folder.created",
  "folder.renamed",
  "folder.deleted",
  "wikilinks.synced",
  "phantom.entity_created",
  // summit / events
  "squad.joined",
  "squad.confirmed",
  "session.attendance_toggled",
  "meeting.requested",
  "meeting.confirmed",
  "meeting.declined",
  "note.saved",
  "note.updated",
  "note.deleted",
  "summit.profile_setup",
  // asks
  "ask.created",
  "ask.answered",
  // listen
  "listen.policy_set",
  "listen.requested",
  "listen.accepted",
  "listen.declined",
  "listen.stopped",
  // economy
  "credits.boost_purchased",
  "credits.granted",
  "wallet.spent",
  "wallet.earned",
  "wallet.topped_up",
  "contribution.recorded",
  // places / catalog / moderation
  "place.saved",
  "place.unsaved",
  "place.menu_proposed",
  "place.photo_submitted",
  "place.edit_suggested",
  "moderation.suggestion_approved",
  "moderation.suggestion_rejected",
  "place.link_submitted",
  "place.link_resolved",
  "places.imported",
  // specialists
  "specialist.claim_submitted",
  "specialist.claim_reviewed",
  "specialist.profile_updated",
  "specialist.manager_added",
  "specialist.manager_removed",
  "specialist.verification_granted",
  "specialist.verification_revoked",
  "specialist.subscription_changed",
  // feedback / media
  "feedback.submitted",
  "media.uploaded",
  // admin / ontology
  "ontology.app_changed",
  "ontology.type_changed",
  "ontology.relation_changed",
  "admin.entity_updated",
  "admin.entity_deleted",
  "admin.relation_changed",
  "admin.bulk_imported",
  "admin.routing_changed",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(DOMAIN_EVENT_TYPES);
export const isDomainEventType = (t: string): t is DomainEventType => TYPE_SET.has(t);

export type DomainEventSource = "graph-service" | "web" | "extractor";

export interface DomainEvent {
  id: string;
  type: DomainEventType;
  /** ISO timestamp — the Kibana time field. */
  ts: string;
  /** Acting user (absent for system/connector events). */
  userId?: string;
  /** App/Space scope when relevant (general, summit, …). */
  app?: string;
  /** Primary object of the action (node id, row id, …). */
  targetId?: string;
  targetType?: string;
  /** Flat extras: ids, counts, enum states — never free text. */
  payload?: Record<string, unknown>;
  source: DomainEventSource;
}

/** Envelope guard for the ingest route (BFF/extractor-sourced events). */
export function validateDomainEvent(raw: unknown): DomainEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !isDomainEventType(e.type)) return null;
  const source = e.source;
  if (source !== "graph-service" && source !== "web" && source !== "extractor") return null;
  return {
    id: typeof e.id === "string" && e.id ? e.id.slice(0, 60) : `ev_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`,
    type: e.type,
    ts: typeof e.ts === "string" && !Number.isNaN(Date.parse(e.ts)) ? e.ts : new Date().toISOString(),
    ...(typeof e.userId === "string" && e.userId ? { userId: e.userId.slice(0, 120) } : {}),
    ...(typeof e.app === "string" && e.app ? { app: e.app.slice(0, 40) } : {}),
    ...(typeof e.targetId === "string" && e.targetId ? { targetId: e.targetId.slice(0, 200) } : {}),
    ...(typeof e.targetType === "string" && e.targetType ? { targetType: e.targetType.slice(0, 40) } : {}),
    ...(e.payload && typeof e.payload === "object" ? { payload: e.payload as Record<string, unknown> } : {}),
    source,
  };
}
