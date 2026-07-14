/**
 * Unified ranking pipeline (Doc #10). A PURE, ordered, config-driven sequence of
 * independent stages — the one place the divergent per-engine scoring formulas
 * converge. Each stage has a single responsibility, reads its weight from
 * `RankingConfig` (no hardcoded numbers in business logic), and contributes an
 * explainable `RankingFactor`. The final order is derived from the factor sum.
 *
 * Stage order (each independently testable):
 *   eligibility → fraud → contextMatch → recommendationQuality →
 *   topicReputation → relationshipStrength → outcomeEvidence → personalization →
 *   finalize
 *
 * Frozen guarantees:
 *  - **Separation** — reputation, relationship strength, trust and personalization
 *    enter as SEPARATE inputs and SEPARATE factors; a stage never reads another's
 *    raw signal.
 *  - **Anti-manipulation** — the candidate shape has NO field for payment,
 *    profile-completeness, listen-count or invite-count; those signals are
 *    structurally unable to influence the score (#10).
 *  - **Stability** — scores are rounded and ties broken deterministically so tiny
 *    signal deltas don't reorder results.
 *  - **Explainability** — `explainRanking` describes evidence, never raw weights.
 */

/** Inputs the pipeline is allowed to see. Deliberately excludes any pay-to-rank
 *  / vanity signal — see FORBIDDEN_SIGNALS. */
export interface RankingCandidate {
  nodeId: string;
  /** Structural trust strength from transfer, [0,1] — the base. */
  trustStrength: number;
  /** Recommendation quality (specificity/context/reasons), [0,1]. */
  quality?: number;
  /** Context fit for the query situation, [0,1]. Default 1 (no context = neutral). */
  contextMatch?: number;
  /** Topic-scoped DERIVED reputation (effective), [-1,1]. */
  reputation?: number;
  /** Relationship strength of the conduit (personalization), [0,1]. */
  relationship?: number;
  /** Cached outcome evidence on the trust edge, [-1,1]. */
  outcome?: number;
  /** Viewer affinity (personalization), [0,1]. */
  personalization?: number;
  /** Eligibility gate — ineligible candidates are dropped. Default true. */
  eligible?: boolean;
  /** Fraud risk [0,1] — dropped at/above the configured threshold. Default 0 (stub). */
  fraudRisk?: number;
  /** Passthrough label for explanations. */
  label?: string;
}

export interface RankingFactor {
  stage: string;
  contribution: number;
  /** Optional evidence phrase for explanations (not a raw number). */
  detail?: string;
}

export interface RankingResult {
  nodeId: string;
  score: number;
  factors: RankingFactor[];
  reasons: string[];
}

export interface RankingConfig {
  weights: {
    quality: number;
    reputation: number;
    relationship: number;
    outcome: number;
    personalization: number;
  };
  /** Drop candidates at/above this fraud risk. */
  fraudThreshold: number;
  /** Score rounding decimals — stability against tiny deltas. */
  stabilityDecimals: number;
  /**
   * Name of the base factor. Defaults to "trust" (the trust-transfer strength).
   * Surfaces that rank an ELIGIBLE set with no trust behind it — e.g. the Listen
   * feed — must override this (e.g. "eligibility"), because reporting a "trust"
   * factor where no trust exists would contradict the frozen Listen guarantee.
   */
  baseStage?: string;
}

/** Signals that must NEVER influence ranking (#10 anti-manipulation). Documented
 *  here and enforced structurally: none of these are fields on RankingCandidate. */
export const FORBIDDEN_SIGNALS = [
  "payment",
  "subscription",
  "profile_completeness",
  "listen_count",
  "invite_count",
  "followers",
] as const;

export const RANKING_CONFIG: RankingConfig = {
  weights: {
    quality: 0.15,
    reputation: 0.3, // == TRUST_W_OUTCOME scale
    relationship: 0.2,
    outcome: 0.3,
    personalization: 0.2,
  },
  fraudThreshold: 0.8,
  stabilityDecimals: 3,
};

const num = (v: number | undefined, dflt: number): number => (typeof v === "number" ? v : dflt);

/**
 * Rank candidates through the staged pipeline. `cfg` is a shallow override of the
 * defaults (services pass env-derived weights). Deterministic + pure.
 */
export function rankCandidates(
  candidates: RankingCandidate[],
  cfg: Partial<RankingConfig> = {},
): RankingResult[] {
  const w = { ...RANKING_CONFIG.weights, ...(cfg.weights ?? {}) };
  const fraudThreshold = cfg.fraudThreshold ?? RANKING_CONFIG.fraudThreshold;
  const decimals = cfg.stabilityDecimals ?? RANKING_CONFIG.stabilityDecimals;
  const baseStage = cfg.baseStage ?? RANKING_CONFIG.baseStage ?? "trust";
  const round = (v: number) => {
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  };

  const results: RankingResult[] = [];
  for (const c of candidates) {
    // Stage 1–2: eligibility + fraud gates.
    if (c.eligible === false) continue;
    if (num(c.fraudRisk, 0) >= fraudThreshold) continue;

    const factors: RankingFactor[] = [];
    const reasons: string[] = [];

    // Base = structural trust (or, for a non-trust surface, plain eligibility).
    const base = Math.max(0, c.trustStrength);
    factors.push({ stage: baseStage, contribution: base });

    // Stage 3: context match — a gate on the base [0,1] (missing = neutral 1).
    const context = num(c.contextMatch, 1);
    const contexted = base * context;
    if (context < 1) factors.push({ stage: "contextMatch", contribution: contexted - base, detail: "narrowed to your situation" });

    // Signed evidence modifiers on the (contexted) base — reputation & outcome.
    const reputation = num(c.reputation, 0);
    const outcome = num(c.outcome, 0);
    const repContribution = w.reputation * reputation * contexted;
    const outContribution = w.outcome * outcome * contexted;
    // Stage 4: recommendation quality (additive).
    const quality = num(c.quality, 0);
    const qualContribution = w.quality * quality;
    // Stage 6: relationship strength (additive personalization).
    const relationship = num(c.relationship, 0);
    const relContribution = w.relationship * relationship;
    // Stage 8: personalization (additive).
    const personalization = num(c.personalization, 0);
    const persContribution = w.personalization * personalization;

    if (qualContribution) factors.push({ stage: "recommendationQuality", contribution: qualContribution });
    if (repContribution)
      factors.push({ stage: "topicReputation", contribution: repContribution, detail: reputation > 0 ? "positive track record on this topic" : "mixed track record on this topic" });
    if (relContribution) factors.push({ stage: "relationshipStrength", contribution: relContribution, detail: "someone you're close to" });
    if (outContribution) factors.push({ stage: "outcomeEvidence", contribution: outContribution, detail: outcome > 0 ? "good outcomes reported" : "negative outcomes reported" });
    if (persContribution) factors.push({ stage: "personalization", contribution: persContribution, detail: "fits your interests" });

    // Stage 9: finalize.
    const score = round(
      contexted + repContribution + outContribution + qualContribution + relContribution + persContribution,
    );
    factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    for (const f of factors) if (f.detail) reasons.push(f.detail);

    results.push({ nodeId: c.nodeId, score, factors, reasons });
  }

  // Stability: sort by score desc, ties broken deterministically by nodeId.
  results.sort((a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : 1));
  return results;
}

/** Human "why", from evidence factors — never raw scores (#10 explainability). */
export function explainRanking(r: RankingResult): string {
  const top = r.factors.filter((f) => f.detail).slice(0, 3);
  if (top.length === 0) return "Reached through your trusted network.";
  return top.map((f) => f.detail).join("; ");
}
