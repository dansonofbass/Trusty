/**
 * Reputation — a PURE, topic-scoped, derived measure of a provider's historical
 * reliability. Never stored as an authoritative score, never user-editable;
 * always recomputed from outcome evidence (Doc #10 "Reputation is earned…never
 * assigned…continuously recalculated").
 *
 * This module owns only the math so it stays deterministic and testable; the SQL
 * (reading `trust_outcomes`) and the topic rollup live in the services that call
 * it (graph-service `reputation.ts`, recommender `affinity.ts`).
 *
 * Three properties the spec freezes:
 *  - **Stability** — Bayesian shrinkage toward a neutral prior + slow time-decay,
 *    so one outcome can't dominate and reputation moves slowly (#9 Principle 6,
 *    #10 "favor stability over volatility").
 *  - **Consensus by independence** — confidence rises with the count of *distinct*
 *    contributors, not raw volume (#10 "convergence of independent observations,
 *    never simple vote counts").
 *  - **Topic-scoped** — computed per topic; a strong dentist reputation says
 *    nothing about lawyers (#10). Rollup across the topic hierarchy is the
 *    caller's job (it holds TOPIC_PARENT).
 */

/** One outcome observation feeding a (provider, topic) reputation. */
export interface ReputationSample {
  /** Normalized outcome in [-1,1]. */
  value: number;
  /** The contributor who reported it — for independent-consensus counting. */
  contributorId: string;
  /** Epoch ms when it was recorded (for time-decay). */
  atMs: number;
}

export interface ReputationScore {
  /** Shrunk, time-decayed weighted mean in [-1,1]. */
  score: number;
  /** Evidence confidence in [0,1] from volume + independent contributors. */
  confidence: number;
  /** score × confidence — the ranking-ready signal (low evidence ⇒ near-neutral). */
  effective: number;
  /** Number of outcome observations. */
  samples: number;
  /** Number of distinct contributors (independence). */
  contributors: number;
}

export interface ReputationOptions {
  /** Reference time (epoch ms) — passed in so the math stays deterministic. */
  now: number;
  /** Outcome weight halves after this many days. Default 180 (slow). */
  halfLifeDays?: number;
  /** Shrinkage strength K — larger = more pull toward the prior. Default 3. */
  priorStrength?: number;
  /** Neutral prior the mean shrinks toward. Default 0. */
  prior?: number;
  /** Confidence saturates as distinct contributors grow. Default 2. */
  consensusK?: number;
}

export const REPUTATION_DEFAULTS: Required<Omit<ReputationOptions, "now">> = {
  halfLifeDays: 180,
  priorStrength: 3,
  prior: 0,
  consensusK: 2,
};

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Aggregate one (provider, topic) group of outcome samples into a stable,
 * consensus-weighted reputation. `samples` must already be filtered to the
 * provider + topic (incl. any hierarchy rollup) the caller wants.
 */
export function aggregateReputation(
  samples: ReputationSample[],
  opts: ReputationOptions,
): ReputationScore {
  const halfLife = opts.halfLifeDays ?? REPUTATION_DEFAULTS.halfLifeDays;
  const K = opts.priorStrength ?? REPUTATION_DEFAULTS.priorStrength;
  const prior = opts.prior ?? REPUTATION_DEFAULTS.prior;
  const consensusK = opts.consensusK ?? REPUTATION_DEFAULTS.consensusK;
  const dayMs = 86_400_000;

  if (samples.length === 0) {
    return { score: prior, confidence: 0, effective: 0, samples: 0, contributors: 0 };
  }

  let wSum = 0;
  let wvSum = 0;
  const contributors = new Set<string>();
  for (const s of samples) {
    const ageDays = Math.max(0, (opts.now - s.atMs) / dayMs);
    const w = Math.pow(0.5, ageDays / halfLife);
    wSum += w;
    wvSum += w * clamp1(s.value);
    contributors.add(s.contributorId);
  }

  // Bayesian shrinkage toward the neutral prior — one outcome can't dominate.
  const score = clamp1((wvSum + K * prior) / (wSum + K));
  // Confidence grows with independent contributors, saturating (never a vote count).
  const confidence = 1 - Math.exp(-contributors.size / consensusK);

  return {
    score,
    confidence,
    effective: score * confidence,
    samples: samples.length,
    contributors: contributors.size,
  };
}
