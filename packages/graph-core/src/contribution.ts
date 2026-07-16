/**
 * Contribution Engine — a PURE, derived measure of how much a person has made
 * the Trust Network better (issues #20/#21/#22).
 *
 * Contribution answers "how much has this person helped the network learn?" —
 * it is a FOURTH independent pillar next to Trust, Reputation and Relationship
 * Strength, and must never be confused with activity, popularity or engagement.
 * The spec freezes these properties:
 *
 *  - **Impact, not effort.** Only actions that leave the graph more accurate,
 *    more complete or more useful count. Value comes from a closed KIND
 *    REGISTRY; anything not in it — logins, clicks, searches, views, followers,
 *    subscriptions, payments — is structurally worth zero (#21 "Contribution is
 *    NOT"). There is deliberately no trust, reputation, payment or popularity
 *    input anywhere in this module's signature.
 *  - **Lifecycle before reward.** Every event carries a status
 *    (recorded → validated → accepted, or rejected). Submission alone earns a
 *    small provisional value; validated graph improvements earn full value;
 *    rejected events stay in history but count for nothing (#21 lifecycle,
 *    "preserve history while allowing interpretation to evolve").
 *  - **Quality dominates quantity.** Independent validation of an authored
 *    recommendation is worth more than creating one; flooding the same kind of
 *    event within a day is burst-damped so the 50th generic action is worth a
 *    fraction of the 1st (#22 "quality before quantity").
 *  - **Consistency over bursts.** Distinct active months raise a saturating
 *    multiplier, so two years of monthly contribution beats one busy weekend
 *    (#22 "long-term consistency").
 *  - **Contribution does not decay.** The lifetime component never decays;
 *    a momentum component (half-life decayed) rewards recent value without
 *    erasing history (#22 "momentum should never erase history").
 *  - **Explainable.** The score decomposes into per-kind factors with phrases
 *    that reference real graph improvements, never arbitrary points.
 *  - **Topic-aware without redesign.** Events optionally carry a topic; pass a
 *    topic filter to compute domain-scoped contribution (V1 default: global).
 *
 * Pure + deterministic — no I/O, no clock (`now` is passed in). The evidence
 * itself lives in the stores that already record it (recommendation nodes,
 * trust_outcomes, place_suggestions, contribution_events); the service layer
 * derives `ContributionEvent`s from them and calls this math.
 */

/* ------------------------------- model -------------------------------- */

export type ContributionCategory = "creation" | "validation" | "improvement" | "maintenance";

/** #21 lifecycle: Observed→Recorded→Validated→Accepted (or rejected on review). */
export type ContributionStatus = "recorded" | "validated" | "accepted" | "rejected";

/** One knowledge-improving act, derived from evidence — never self-reported. */
export interface ContributionEvent {
  /** Registry key, e.g. "recommendation_created". Unknown kinds count for 0. */
  kind: string;
  status: ContributionStatus;
  /** Epoch ms when it happened (for burst-damping, consistency, momentum). */
  atMs: number;
  /** Optional topic for future domain-scoped contribution. */
  topic?: string;
  /** Optional stable reference (rec id, place id, …) for auditability. */
  refId?: string;
}

export interface ContributionKindDef {
  category: ContributionCategory;
  /** Value units for one fully-accepted event of this kind. */
  baseValue: number;
  /** Explanation template — "%n" is replaced with the event count. */
  phrase: string;
}

/**
 * The closed registry of rewardable kinds. Adding a future contribution type =
 * adding an entry here (and an evidence source) — no engine redesign (#21
 * acceptance: "architecture supports future contribution types").
 * Validation weighs MORE than creation (#21 "validation is generally more
 * valuable than simple creation because it reduces uncertainty").
 */
export const CONTRIBUTION_KINDS: Record<string, ContributionKindDef> = {
  /* -- knowledge creation -- */
  recommendation_created: {
    category: "creation",
    baseValue: 2,
    phrase: "You shared %n recommendation(s), adding new knowledge for future decisions",
  },
  entity_added: {
    category: "creation",
    baseValue: 2,
    phrase: "You added %n missing place(s) or specialist(s) to the network",
  },
  photo_added: {
    category: "creation",
    baseValue: 1,
    phrase: "%n of your photos now help others recognize real places",
  },
  dish_added: {
    category: "creation",
    baseValue: 1,
    phrase: "You documented %n dish(es), making menus more complete",
  },
  /* -- knowledge validation (reduces uncertainty — weighs most) -- */
  outcome_recorded: {
    category: "validation",
    baseValue: 1,
    phrase: "You reported %n real outcome(s), reducing uncertainty for everyone after you",
  },
  recommendation_validated: {
    category: "validation",
    baseValue: 3,
    phrase: "Your recommendations produced %n independently verified outcome(s)",
  },
  /* -- knowledge improvement -- */
  entity_correction: {
    category: "improvement",
    baseValue: 2,
    phrase: "Your %n approved correction(s) improved place and specialist profiles",
  },
  /* -- knowledge maintenance (grows in value as the graph matures) -- */
  entity_maintenance: {
    category: "maintenance",
    baseValue: 1.5,
    phrase: "You kept %n record(s) accurate (hours, closures, availability)",
  },
};

/**
 * Activity that must NEVER produce contribution (#21 "Contribution is NOT").
 * Exported as a contract for emitters and tests — parallel to the ranking
 * pipeline's FORBIDDEN_SIGNALS. These are not in the registry, so even if an
 * emitter records them they aggregate to zero.
 */
export const NON_CONTRIBUTION_ACTIVITY: readonly string[] = [
  "login",
  "session_time",
  "click",
  "search",
  "view",
  "profile_visit",
  "follower_count",
  "listener_count",
  "subscription",
  "payment",
  "invite_sent",
  "comment",
] as const;

/* ------------------------------- config ------------------------------- */

export interface ContributionStage {
  name: string;
  /** Minimum score for this stage. */
  min: number;
}

/** #22 maturity progression — presentation-independent, thresholds tunable. */
export const CONTRIBUTION_STAGES: ContributionStage[] = [
  { name: "New Contributor", min: 0 },
  { name: "Occasional Contributor", min: 5 },
  { name: "Active Contributor", min: 15 },
  { name: "Reliable Contributor", min: 40 },
  { name: "Trusted Contributor", min: 90 },
  { name: "Knowledge Builder", min: 180 },
  { name: "Community Expert", min: 350 },
];

export interface ContributionConfig {
  /** Lifecycle multipliers — submission earns little, validation earns full. */
  statusMultiplier: Record<ContributionStatus, number>;
  /** nth same-kind event within one UTC day is worth burstDecay^(n-1). */
  burstDecay: number;
  /** Momentum half-life in days (recent value emphasis, never erases history). */
  momentumHalfLifeDays: number;
  /** Blend: score core = lifetime·wL + momentum·wM (fresh event ≈ full value). */
  lifetimeWeight: number;
  momentumWeight: number;
  /** Consistency bonus saturates with distinct active months. */
  consistencyMax: number;
  consistencyMonthsK: number;
  /** Diversity bonus for improving different parts of the graph (a signal). */
  diversityMax: number;
  /** Rounding for ranking stability (same idea as ranking.ts). */
  stabilityDecimals: number;
  stages: ContributionStage[];
}

export const CONTRIBUTION_DEFAULTS: ContributionConfig = {
  statusMultiplier: { recorded: 0.25, validated: 1, accepted: 1, rejected: 0 },
  burstDecay: 0.7,
  momentumHalfLifeDays: 90,
  lifetimeWeight: 0.7,
  momentumWeight: 0.3,
  consistencyMax: 0.5,
  consistencyMonthsK: 6,
  diversityMax: 0.15,
  stabilityDecimals: 2,
  stages: CONTRIBUTION_STAGES,
};

/* ------------------------------- output ------------------------------- */

export interface ContributionFactor {
  kind: string;
  category: ContributionCategory;
  /** Counted (non-rejected) events of this kind. */
  count: number;
  /** Value contributed to the lifetime component. */
  value: number;
  /** Human explanation referencing the graph improvement. */
  phrase: string;
}

export interface ContributionScore {
  /** Final explainable score (≥0). NOT trust, NOT reputation. */
  score: number;
  /** Undecayed value sum — history never decays (#22). */
  lifetime: number;
  /** Half-life-decayed value sum — recent engagement signal. */
  momentum: number;
  /** Consistency multiplier ≥ 1 (distinct active months). */
  consistency: number;
  /** Diversity multiplier ≥ 1 (distinct categories improved). */
  diversity: number;
  /** Maturity stage name for the score. */
  stage: string;
  /** Events that carried value (known kind, not rejected). */
  events: number;
  /** Per-kind breakdown, highest value first — the explanation source. */
  factors: ContributionFactor[];
}

/* -------------------------------- math -------------------------------- */

const DAY_MS = 86_400_000;

/** Stage for a score (stages must be sorted ascending by min). */
export function contributionStage(
  score: number,
  stages: ContributionStage[] = CONTRIBUTION_STAGES,
): string {
  let name = stages[0]?.name ?? "New Contributor";
  for (const s of stages) if (score >= s.min) name = s.name;
  return name;
}

export interface ContributionOptions {
  /** Reference time (epoch ms) — passed in so the math stays deterministic. */
  now: number;
  /** Restrict to one topic (equality; hierarchy rollup is the caller's job). */
  topic?: string;
  config?: Partial<ContributionConfig>;
}

/**
 * Aggregate one person's contribution events into a stable, explainable score.
 * Deterministic; order of `events` does not matter.
 */
export function aggregateContribution(
  events: ContributionEvent[],
  opts: ContributionOptions,
): ContributionScore {
  const cfg: ContributionConfig = {
    ...CONTRIBUTION_DEFAULTS,
    ...opts.config,
    statusMultiplier: {
      ...CONTRIBUTION_DEFAULTS.statusMultiplier,
      ...opts.config?.statusMultiplier,
    },
  };

  const scoped = opts.topic ? events.filter((e) => e.topic === opts.topic) : events;

  // Burst damping needs same-day ordering per kind — sort a copy, never mutate.
  const ordered = [...scoped].sort((a, b) => a.atMs - b.atMs);
  const dayCount = new Map<string, number>(); // `${kind}:${utcDay}` → events so far

  let lifetime = 0;
  let momentum = 0;
  let counted = 0;
  const perKind = new Map<string, { count: number; value: number }>();
  const categories = new Set<ContributionCategory>();
  const activeMonths = new Set<string>();

  for (const e of ordered) {
    const def = CONTRIBUTION_KINDS[e.kind];
    if (!def) continue; // unknown kind or plain activity — worth exactly zero
    const statusMult = cfg.statusMultiplier[e.status] ?? 0;
    if (statusMult <= 0) continue; // rejected: preserved in history, no value

    const dayKey = `${e.kind}:${Math.floor(e.atMs / DAY_MS)}`;
    const nth = dayCount.get(dayKey) ?? 0;
    dayCount.set(dayKey, nth + 1);
    const burst = Math.pow(cfg.burstDecay, nth);

    const value = def.baseValue * statusMult * burst;
    if (value <= 0) continue;

    lifetime += value;
    const ageDays = Math.max(0, (opts.now - e.atMs) / DAY_MS);
    momentum += value * Math.pow(0.5, ageDays / cfg.momentumHalfLifeDays);
    counted += 1;
    categories.add(def.category);
    const d = new Date(e.atMs);
    activeMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
    const agg = perKind.get(e.kind) ?? { count: 0, value: 0 };
    agg.count += 1;
    agg.value += value;
    perKind.set(e.kind, agg);
  }

  // Consistency: 1 active month is the baseline; sustained months saturate up.
  const months = activeMonths.size;
  const consistency =
    months <= 1
      ? 1
      : 1 + cfg.consistencyMax * (1 - Math.exp(-(months - 1) / cfg.consistencyMonthsK));
  // Diversity: improving different parts of the graph is a (small) extra signal.
  const diversity =
    categories.size <= 1 ? 1 : 1 + (cfg.diversityMax * (categories.size - 1)) / 3;

  const core = lifetime * cfg.lifetimeWeight + momentum * cfg.momentumWeight;
  const p = Math.pow(10, cfg.stabilityDecimals);
  const score = Math.round(core * consistency * diversity * p) / p;

  const factors: ContributionFactor[] = [...perKind.entries()]
    .map(([kind, agg]) => ({
      kind,
      category: CONTRIBUTION_KINDS[kind].category,
      count: agg.count,
      value: Math.round(agg.value * p) / p,
      phrase: CONTRIBUTION_KINDS[kind].phrase.replace("%n", String(agg.count)),
    }))
    .sort((a, b) => b.value - a.value || a.kind.localeCompare(b.kind));

  return {
    score,
    lifetime: Math.round(lifetime * p) / p,
    momentum: Math.round(momentum * p) / p,
    consistency: Math.round(consistency * 1000) / 1000,
    diversity: Math.round(diversity * 1000) / 1000,
    stage: contributionStage(score, cfg.stages),
    events: counted,
    factors,
  };
}

/**
 * Human explanations for why contribution grew — always phrased as real graph
 * improvements, never arbitrary points (#22 "contribution visibility").
 */
export function explainContribution(s: ContributionScore): string[] {
  return s.factors.filter((f) => f.value > 0).map((f) => f.phrase);
}
