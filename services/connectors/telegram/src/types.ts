/**
 * Canonical shapes for the Telegram connector.
 *
 * Everything downstream (classification, extraction, review) works on `TgMessage`
 * — never on a raw export row or a Bot API update. Adding a source means writing
 * one adapter to this type and nothing else.
 */

/** A group we watch. Persisted in graph-service; mirrored here per run. */
export interface TgSource {
  id: string;
  /** Display name of the group, as exported. */
  title: string;
  /** Telegram chat id when known (Bot API needs it; exports carry it too). */
  chatId?: string;
  /** Which space/app this group's knowledge belongs to. */
  app: string;
  /** Circle label that approved knowledge lands in, unless a rule overrides. */
  defaultCircle: string;
  /** "export" | "bot" */
  kind: SourceKind;
  /** Two-letter hint that steers the classifier's lexicon. */
  lang: "fa" | "en" | "mixed";
  enabled: boolean;
}

export type SourceKind = "export" | "bot";

/** One normalized message. `id` is unique within a source. */
export interface TgMessage {
  sourceId: string;
  id: number;
  date: string;
  /** Author display name. We never store phone numbers or user ids of members. */
  from: string;
  /** Stable pseudonymous author key, hashed — enough to count a person, not to identify them. */
  authorKey: string;
  text: string;
  replyTo?: number;
  /** Entity counts, used as classification signal (a phone number smells like an ad). */
  ent: { phone: number; mention: number; link: number; bold: number; email: number };
  hasMedia: boolean;
}

export type MsgClass =
  | "ad"
  | "listing"
  | "question"
  | "answer"
  | "statement"
  | "chatter"
  | "media";

export interface Classified extends TgMessage {
  cls: MsgClass;
  /** 0–1. Below `MIN_CONFIDENCE` the row is sent to review rather than trusted. */
  confidence: number;
  topics: string[];
  /** Why the classifier decided this — shown in admin so a human can audit it. */
  why: string[];
}

/** What the connector produces. Nothing is published without human approval. */
export type CandidateKind = "qa" | "outcome" | "provider";

export interface CandidateBase {
  /** Deterministic — re-running a source never duplicates a candidate. */
  key: string;
  sourceId: string;
  kind: CandidateKind;
  /** Message ids this was derived from, for the audit trail. */
  evidence: number[];
  /** 0–1 confidence from the pipeline stage that produced it. */
  confidence: number;
  /** "heuristic" | "llm" — which stage produced it. */
  stage: string;
  createdAt: string;
}

export interface QaCandidate extends CandidateBase {
  kind: "qa";
  circle: string;
  title: string;
  body: string;
  answer: string;
  tags: string[];
  /** Set when the answer contains a fee, a deadline, an office name or a form number. */
  hasHardSpecific: boolean;
}

export interface OutcomeCandidate extends CandidateBase {
  kind: "outcome";
  step: string;
  provider?: string;
  result: "approved" | "rejected" | "pending" | "abandoned";
  reasonCode?: string;
  costAmd?: number;
  durationDays?: number;
  occurredAt: string;
}

export interface ProviderCandidate extends CandidateBase {
  kind: "provider";
  provider: string;
  category: string;
  verdict: "works" | "blocked" | "contested";
  /** Distinct authors who reported this — the only number that matters for trust. */
  reporters: number;
}

export type Candidate = QaCandidate | OutcomeCandidate | ProviderCandidate;

export interface RunReport {
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  messagesSeen: number;
  messagesNew: number;
  byClass: Record<string, number>;
  candidates: { qa: number; outcome: number; provider: number };
  /** Non-fatal problems worth showing an admin (a malformed export, a skipped batch). */
  warnings: string[];
}
