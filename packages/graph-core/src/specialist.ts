/**
 * Specialist platform core (#38/#39) — pure domain logic.
 *
 * A Specialist ENTITY (the graph node: lawyer, broker, …) is not a Specialist
 * ACCOUNT (an authenticated user with management authority). Profiles may
 * exist unclaimed, get claimed through an evidence-reviewed flow, and carry
 * layered field data where every field remembers its source. Independent
 * evidence (recommendations/outcomes/reputation) is NEVER stored on the
 * profile — it is derived on read by the service layer, so the specialist
 * cannot edit it by construction.
 *
 * Like journeys/contribution, state is event-sourced: `specialist_events` is
 * the source of truth and the profile row caches the derived state.
 */

/* ------------------------------ types ------------------------------ */

/** Ontology entity types that can carry a specialist profile (individual
 *  professionals and professional practices — not generic places). */
export const SPECIALIST_TYPES = [
  "lawyer",
  "broker",
  "immigration_consultant",
  "accountant",
  "doctor",
  "dentist",
  "mechanic",
  "plumber",
  "electrician",
] as const;
export type SpecialistType = (typeof SPECIALIST_TYPES)[number];

export function isSpecialistType(type: string | undefined): type is SpecialistType {
  return !!type && (SPECIALIST_TYPES as readonly string[]).includes(type);
}

/** Lifecycle states (#39). `discovered` = raw ingest not yet normalized;
 *  entities entering via the ontology/catalog start at `unclaimed`. */
export type SpecialistState =
  | "discovered"
  | "created"
  | "unclaimed"
  | "claim_requested"
  | "claim_under_review"
  | "claimed"
  | "verified"
  | "claim_rejected"
  | "suspended"
  | "inactive"
  | "retired"
  | "closed"
  | "merged"
  | "disputed";

/** Legal transitions. Kept intentionally permissive where the RFC allows
 *  operational judgement (e.g. suspended → claimed reinstatement), strict
 *  where integrity demands it (nothing leaves `merged`). */
export const SPECIALIST_TRANSITIONS: Record<SpecialistState, readonly SpecialistState[]> = {
  discovered: ["created", "closed"],
  created: ["unclaimed", "closed", "merged"],
  unclaimed: ["claim_requested", "inactive", "retired", "closed", "merged", "disputed", "suspended"],
  claim_requested: ["claim_under_review", "claim_rejected", "unclaimed"],
  claim_under_review: ["claimed", "claim_rejected"],
  claim_rejected: ["unclaimed", "claim_requested"],
  claimed: ["verified", "suspended", "inactive", "retired", "closed", "merged", "disputed"],
  verified: ["claimed", "suspended", "inactive", "retired", "closed", "merged", "disputed"],
  suspended: ["claimed", "unclaimed", "closed"],
  inactive: ["claimed", "unclaimed", "retired", "closed"],
  retired: ["closed"],
  disputed: ["claimed", "unclaimed", "suspended", "merged"],
  closed: [],
  merged: [],
};

export function canTransitionSpecialist(from: SpecialistState, to: SpecialistState): boolean {
  return (SPECIALIST_TRANSITIONS[from] ?? []).includes(to);
}

/* --------------------------- event model --------------------------- */

export type SpecialistEventKind =
  | "state_changed"
  | "claim_submitted"
  | "claim_review_started"
  | "claim_approved"
  | "claim_rejected"
  | "field_updated"
  | "manager_added"
  | "manager_removed"
  | "verification_added"
  | "verification_expired"
  | "suspended"
  | "reinstated"
  | "merged";

export interface SpecialistEvent {
  kind: SpecialistEventKind;
  /** userId of the actor ("system" for automated transitions). */
  actor: string;
  detail?: Record<string, unknown>;
  at: string;
}

/** Events that imply a lifecycle state without an explicit state_changed. */
const EVENT_STATE: Partial<Record<SpecialistEventKind, SpecialistState>> = {
  claim_submitted: "claim_requested",
  claim_review_started: "claim_under_review",
  claim_approved: "claimed",
  claim_rejected: "claim_rejected",
  verification_added: "verified",
  suspended: "suspended",
  merged: "merged",
};

/** Replay the event log into the current lifecycle state. Illegal jumps in
 *  the log are ignored (the log is append-only history, not a validator —
 *  validation happens at write time; replay must stay total). */
export function deriveSpecialistState(
  events: readonly SpecialistEvent[],
  initial: SpecialistState = "unclaimed",
): SpecialistState {
  let state = initial;
  for (const ev of events) {
    const target =
      ev.kind === "state_changed" ? (ev.detail?.to as SpecialistState | undefined) :
      ev.kind === "reinstated" ? ("claimed" as const) :
      EVENT_STATE[ev.kind];
    if (target && canTransitionSpecialist(state, target)) state = target;
  }
  return state;
}

/* ------------------------- manager roles --------------------------- */

export type SpecialistManagerRole =
  | "owner"
  | "org_admin"
  | "profile_manager"
  | "staff_editor"
  | "analytics_viewer"
  | "billing_admin";

export interface SpecialistPermissions {
  editProfile: boolean;
  viewAnalytics: boolean;
  manageBilling: boolean;
  manageManagers: boolean;
}

/** Least-privilege permission matrix (#39 "Multiple Profile Managers"). */
export const MANAGER_PERMISSIONS: Record<SpecialistManagerRole, SpecialistPermissions> = {
  owner: { editProfile: true, viewAnalytics: true, manageBilling: true, manageManagers: true },
  org_admin: { editProfile: true, viewAnalytics: true, manageBilling: true, manageManagers: true },
  profile_manager: { editProfile: true, viewAnalytics: false, manageBilling: false, manageManagers: false },
  staff_editor: { editProfile: true, viewAnalytics: false, manageBilling: false, manageManagers: false },
  analytics_viewer: { editProfile: false, viewAnalytics: true, manageBilling: false, manageManagers: false },
  billing_admin: { editProfile: false, viewAnalytics: false, manageBilling: true, manageManagers: false },
};

export const SPECIALIST_MANAGER_ROLES = Object.keys(MANAGER_PERMISSIONS) as SpecialistManagerRole[];

/* ------------------------ layered profile -------------------------- */

/** Where a profile field's value came from — never silently merged (#39). */
export type SpecialistFieldSource =
  | "specialist_provided"
  | "registry"
  | "official_org"
  | "bootstrap"
  | "contributor"
  | "validated_outcome"
  | "system_derived"
  | "admin_verified";

export interface SpecialistField {
  value: unknown;
  source: SpecialistFieldSource;
  updatedAt: string;
}

export type SpecialistLayerName =
  | "identity"
  | "taxonomy"
  | "operational"
  | "credential"
  | "communication"
  | "content";

/** Fields a claimed manager may edit, per layer. The credential layer is
 *  deliberately NOT provider-editable (verification/admin only), and the
 *  independent-evidence layer does not exist here at all — it is computed. */
export const SPECIALIST_EDITABLE_FIELDS: Record<SpecialistLayerName, readonly string[]> = {
  identity: ["displayName", "organization", "photoUrl", "entityKind"],
  taxonomy: ["services", "caseTypes", "clientContexts", "specializations", "serviceAreas"],
  operational: [
    "officeAddress", "serviceArea", "remoteAvailable", "officeHours",
    "consultationMethods", "bookingUrl", "availability", "responseExpectation",
  ],
  credential: [],
  communication: ["languages", "translationSupport", "channels", "preferredContact"],
  content: ["biography", "serviceDescriptions", "approach", "faq", "processExplanation", "website"],
};

export type SpecialistLayers = Partial<Record<SpecialistLayerName, Record<string, SpecialistField>>>;

/** Validate a provider edit: known layer, editable fields only. Returns the
 *  offending field name or null when the patch is acceptable. */
export function invalidProviderField(layer: SpecialistLayerName, fields: Record<string, unknown>): string | null {
  const allowed = SPECIALIST_EDITABLE_FIELDS[layer];
  if (!allowed || allowed.length === 0) return `layer ${layer} is not provider-editable`;
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

/** Stamp a provider patch into layer fields (source + timestamp per field). */
export function applyProviderPatch(
  existing: Record<string, SpecialistField> | undefined,
  fields: Record<string, unknown>,
  source: SpecialistFieldSource,
  at: string,
): Record<string, SpecialistField> {
  const next: Record<string, SpecialistField> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") delete next[key];
    else next[key] = { value, source, updatedAt: at };
  }
  return next;
}

/* -------------------------- claim evidence ------------------------- */

export interface SpecialistClaimEvidence {
  professionalEmail?: string;
  phone?: string;
  licenseNumber?: string;
  licenseAuthority?: string;
  website?: string;
  organization?: string;
  statement?: string;
}

/** A claim needs at least one strong, checkable anchor — never a bare
 *  free-text statement (#39 "avoid a single weak verification method"). */
export function validateClaimEvidence(ev: SpecialistClaimEvidence): string | null {
  const strong = [ev.professionalEmail, ev.phone, ev.licenseNumber, ev.website].some(
    (v) => typeof v === "string" && v.trim().length >= 5,
  );
  if (!strong) return "provide at least one verifiable anchor: professional email, phone, license number, or website";
  if (ev.professionalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev.professionalEmail.trim())) {
    return "professional email looks invalid";
  }
  return null;
}

/* ---------------------- qualitative trust label -------------------- */

/** Frozen qualitative evidence labels (#39 public profile / #18 stickers).
 *  Derived from independent evidence only; thresholds are deliberately
 *  conservative — labels must under-promise. */
export type SpecialistTrustLabel =
  | "limited_evidence"
  | "emerging"
  | "established"
  | "reliable"
  | "highly_reliable";

export interface TrustLabelInput {
  /** independent recommendations targeting the entity */
  recCount: number;
  /** recorded outcomes (any polarity) */
  outcomeCount: number;
  /** distinct contributors across recs+outcomes */
  distinctContributors: number;
  /** effective topic reputation in [0,1] (shrunk + decayed), if any */
  effectiveScore: number | null;
}

export function specialistTrustLabel(e: TrustLabelInput): SpecialistTrustLabel {
  const score = e.effectiveScore ?? 0;
  if (e.distinctContributors >= 8 && e.outcomeCount >= 6 && score >= 0.75) return "highly_reliable";
  if (e.distinctContributors >= 5 && e.outcomeCount >= 3 && score >= 0.6) return "reliable";
  if (e.distinctContributors >= 3 && (e.outcomeCount >= 1 || e.recCount >= 4) && score >= 0.45) return "established";
  if (e.distinctContributors >= 1 && e.recCount >= 1) return "emerging";
  return "limited_evidence";
}

export const TRUST_LABEL_TEXT: Record<SpecialistTrustLabel, string> = {
  limited_evidence: "Limited evidence",
  emerging: "Emerging",
  established: "Established",
  reliable: "Reliable",
  highly_reliable: "Highly reliable",
};
