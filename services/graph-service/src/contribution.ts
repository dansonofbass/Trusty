/**
 * Contribution Engine service layer (issues #20/#21/#22) — derives a user's
 * contribution events from the EVIDENCE the platform already records, then
 * feeds the pure math in @constellation/graph-core `contribution.ts`.
 *
 * Contribution is never stored as an authoritative score (same philosophy as
 * trust/reputation: store evidence, derive understanding). The event stream is
 * assembled on read from:
 *
 *   - recommendation nodes   → recommendation_created   (accepted: it is live)
 *   - trust_outcomes         → outcome_recorded         (validated evidence)
 *   - trust_outcomes on MY recs by OTHERS with positive value
 *                             → recommendation_validated (independent per pair)
 *   - place_suggestions      → entity_correction / photo_added / dish_added,
 *                               lifecycle mapped from the moderation status:
 *                               pending→recorded, approved→accepted,
 *                               rejected→rejected (history kept, value zero)
 *   - contribution_events    → append-only ledger for kinds with no existing
 *                               evidence trail (future types, AI-flagged work,
 *                               manual grants). AI may *suggest* rows here but
 *                               they enter as `recorded` — validation is a
 *                               human/moderation transition, never automatic.
 *
 * Because the score is derived, historical contributions can always be
 * replayed under a future model (#22 "future contribution models should always
 * be able to replay historical contributions"). Degrades gracefully without
 * DATABASE_URL (graph-derived events still work).
 */
import pg from "pg";
import {
  aggregateContribution,
  explainContribution,
  type ContributionConfig,
  type ContributionEvent,
  type ContributionScore,
  type ContributionStatus,
  type GNode,
} from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

/** All tunable — never hardcoded in business logic (#22 config-driven). */
export const CONTRIBUTION_ENV: Partial<ContributionConfig> = {
  momentumHalfLifeDays: Number(process.env.CONTRIB_HALF_LIFE_DAYS ?? 90) || 90,
  burstDecay: Number(process.env.CONTRIB_BURST_DECAY ?? 0.7) || 0.7,
  lifetimeWeight: Number(process.env.CONTRIB_W_LIFETIME ?? 0.7) || 0.7,
  momentumWeight: Number(process.env.CONTRIB_W_MOMENTUM ?? 0.3) || 0.3,
};

export function contributionLedgerEnabled(): boolean {
  return !!pool;
}

export async function initContribution(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — contribution ledger disabled (graph-derived events still work)");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS contribution_events (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'recorded',
      ref_type    TEXT,
      ref_id      TEXT,
      topic       TEXT,
      detail      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ
    )`);
  // Idempotent emission: at most one event per (user, kind, reference).
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS contribution_events_ref_uniq
       ON contribution_events(user_id, kind, ref_id) WHERE ref_id IS NOT NULL`,
  );
  await p.query(`CREATE INDEX IF NOT EXISTS contribution_events_user_idx ON contribution_events(user_id, created_at)`);
  pool = p;
  console.log("graph-service: contribution ledger ready (postgres)");
}

/** Append a ledger event (kinds without an existing evidence trail). Idempotent per ref. */
export async function recordContributionEvent(i: {
  userId: string;
  kind: string;
  status?: ContributionStatus;
  refType?: string;
  refId?: string;
  topic?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO contribution_events (user_id, kind, status, ref_type, ref_id, topic, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
      [
        i.userId,
        i.kind,
        i.status ?? "recorded",
        i.refType ?? null,
        i.refId ?? null,
        i.topic ?? null,
        i.detail ? JSON.stringify(i.detail) : null,
      ],
    )
    .catch((e) => console.error("graph-service: recordContributionEvent failed:", e instanceof Error ? e.message : e));
}

/** Lifecycle transition (validation/moderation) — history rows are never deleted. */
export async function setContributionEventStatus(id: number, status: ContributionStatus): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE contribution_events SET status = $2, reviewed_at = now() WHERE id = $1`, [id, status]);
}

/* --------------------------- derived events ---------------------------- */

type RecProps = { authorId?: string; topic?: string; createdAt?: number };

const asMs = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** The suggest→approve moderation queue maps 1:1 onto the contribution lifecycle. */
const SUGGESTION_KIND: Record<string, string> = {
  edit: "entity_correction",
  photo: "photo_added",
  menu: "dish_added",
};
const SUGGESTION_STATUS: Record<string, ContributionStatus> = {
  pending: "recorded",
  approved: "accepted",
  rejected: "rejected",
};

/**
 * Assemble the full evidence-derived event stream for one user. Pure reads;
 * every source is best-effort so a missing table never breaks the score.
 */
export async function contributionEventsFor(userId: string, nodes: GNode[]): Promise<ContributionEvent[]> {
  const events: ContributionEvent[] = [];

  // Recommendations this user authored — live graph knowledge (accepted).
  const authored = nodes.filter(
    (n) => n.type === "recommendation" && (n.properties as RecProps | undefined)?.authorId === userId,
  );
  const authoredIds: string[] = [];
  const recTopic = new Map<string, string | undefined>();
  for (const n of authored) {
    const p = (n.properties ?? {}) as RecProps;
    authoredIds.push(n.id);
    recTopic.set(n.id, p.topic);
    events.push({
      kind: "recommendation_created",
      status: "accepted",
      atMs: asMs(p.createdAt),
      topic: p.topic,
      refId: n.id,
    });
  }

  if (pool) {
    // Outcomes this user reported — validation evidence they gave the network.
    try {
      const r = await pool.query(
        `SELECT rec_node_id, scope->>'topic' AS topic, at FROM trust_outcomes WHERE user_id = $1`,
        [userId],
      );
      for (const row of r.rows) {
        events.push({
          kind: "outcome_recorded",
          status: "validated",
          atMs: asMs(row.at),
          topic: row.topic ?? undefined,
          refId: row.rec_node_id ?? undefined,
        });
      }
    } catch { /* best-effort */ }

    // Independent positive outcomes OTHERS recorded on this user's recs — the
    // strongest signal that their knowledge genuinely helped (one per
    // (rec, contributor) pair: independence, never a vote count).
    if (authoredIds.length) {
      try {
        const r = await pool.query(
          `SELECT rec_node_id, user_id AS contributor, min(at) AS at
             FROM trust_outcomes
            WHERE rec_node_id = ANY($1) AND user_id <> $2 AND value > 0
            GROUP BY rec_node_id, user_id`,
          [authoredIds, userId],
        );
        for (const row of r.rows) {
          events.push({
            kind: "recommendation_validated",
            status: "validated",
            atMs: asMs(row.at),
            topic: recTopic.get(String(row.rec_node_id)),
            refId: `${row.rec_node_id}:${row.contributor}`,
          });
        }
      } catch { /* best-effort */ }
    }

    // Place suggestions — the moderation queue IS the contribution lifecycle.
    try {
      const r = await pool.query(
        `SELECT id, kind, status, created_at FROM place_suggestions WHERE user_id = $1`,
        [userId],
      );
      for (const row of r.rows) {
        const kind = SUGGESTION_KIND[String(row.kind)] ?? "entity_correction";
        const status = SUGGESTION_STATUS[String(row.status)] ?? "recorded";
        events.push({ kind, status, atMs: asMs(row.created_at), refId: `sugg_${row.id}` });
      }
    } catch { /* best-effort */ }

    // Ledger events (future kinds, AI-flagged, manual grants).
    try {
      const r = await pool.query(
        `SELECT kind, status, topic, ref_id, created_at FROM contribution_events WHERE user_id = $1`,
        [userId],
      );
      for (const row of r.rows) {
        events.push({
          kind: String(row.kind),
          status: (String(row.status) as ContributionStatus) ?? "recorded",
          atMs: asMs(row.created_at),
          topic: row.topic ?? undefined,
          refId: row.ref_id ?? undefined,
        });
      }
    } catch { /* best-effort */ }
  }

  return events;
}

/* ------------------------------ summaries ------------------------------ */

/** Short human labels for the timeline (aggregate phrases live in graph-core). */
const EVENT_LABEL: Record<string, string> = {
  recommendation_created: "Shared a recommendation",
  recommendation_validated: "A recommendation was verified by an independent outcome",
  outcome_recorded: "Reported a real outcome",
  entity_added: "Added a missing place or specialist",
  entity_correction: "Suggested a correction",
  entity_maintenance: "Updated a record to keep it accurate",
  photo_added: "Added a photo",
  dish_added: "Documented a dish",
};

export interface ContributionSummary {
  score: ContributionScore;
  /** Why the score is what it is — real graph improvements, never points. */
  explanations: string[];
  /** Recent contribution history, newest first. */
  timeline: { kind: string; label: string; status: ContributionStatus; at: string; topic?: string }[];
  config: Partial<ContributionConfig>;
}

/** Full score + explanation + history for one user (optionally topic-scoped). */
export async function contributionSummaryFor(
  userId: string,
  nodes: GNode[],
  opts: { topic?: string } = {},
): Promise<ContributionSummary> {
  const events = await contributionEventsFor(userId, nodes);
  const score = aggregateContribution(events, { now: Date.now(), topic: opts.topic, config: CONTRIBUTION_ENV });
  const timeline = [...events]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, 50)
    .map((e) => ({
      kind: e.kind,
      label: EVENT_LABEL[e.kind] ?? e.kind.replace(/_/g, " "),
      status: e.status,
      at: new Date(e.atMs).toISOString(),
      topic: e.topic,
    }));
  return { score, explanations: explainContribution(score), timeline, config: CONTRIBUTION_ENV };
}

/**
 * The single number downstream consumers (Listen capacity today; credits,
 * referral rewards, recognition later per #23/#24) are allowed to consume.
 * They read VALIDATED contribution — never raw activity (#21 acceptance).
 */
export async function contributionValueFor(userId: string, nodes: GNode[]): Promise<number> {
  const events = await contributionEventsFor(userId, nodes);
  return aggregateContribution(events, { now: Date.now(), config: CONTRIBUTION_ENV }).score;
}

/* --------------------------- admin monitoring --------------------------- */

/** Clamp helper for the tuning simulator. */
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/**
 * Sanitize an admin-supplied config override for the tuning simulator. Only
 * whitelisted knobs pass, each clamped to a sane range — a bad payload can
 * never crash scoring or inject weights outside the model's assumptions.
 * Simulation only: making a tuning permanent = setting the CONTRIB_* env vars.
 */
export function sanitizeContributionOverride(raw: unknown): Partial<ContributionConfig> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<ContributionConfig> = {};
  const halfLife = num(o.momentumHalfLifeDays, 1, 3650);
  if (halfLife !== undefined) out.momentumHalfLifeDays = halfLife;
  const burst = num(o.burstDecay, 0.05, 1);
  if (burst !== undefined) out.burstDecay = burst;
  const wl = num(o.lifetimeWeight, 0, 2);
  if (wl !== undefined) out.lifetimeWeight = wl;
  const wm = num(o.momentumWeight, 0, 2);
  if (wm !== undefined) out.momentumWeight = wm;
  const cMax = num(o.consistencyMax, 0, 2);
  if (cMax !== undefined) out.consistencyMax = cMax;
  const cK = num(o.consistencyMonthsK, 1, 60);
  if (cK !== undefined) out.consistencyMonthsK = cK;
  const dMax = num(o.diversityMax, 0, 1);
  if (dMax !== undefined) out.diversityMax = dMax;
  const sm = o.statusMultiplier as Record<string, unknown> | undefined;
  if (sm && typeof sm === "object") {
    const recorded = num(sm.recorded, 0, 2);
    const validated = num(sm.validated, 0, 2);
    const accepted = num(sm.accepted, 0, 2);
    if (recorded !== undefined || validated !== undefined || accepted !== undefined) {
      out.statusMultiplier = {
        recorded: recorded ?? 0.25,
        validated: validated ?? 1,
        accepted: accepted ?? 1,
        rejected: 0, // never tunable — rejected work must stay worthless
      };
    }
  }
  return out;
}

export interface ContributionOverviewRow {
  userId: string;
  score: ContributionScore;
}

/**
 * Score every listed user with the effective config (env + optional simulator
 * override). Powers the admin monitoring/tuning tab — read-only over the same
 * evidence the real engine uses, so what the admin sees IS the algorithm.
 */
export async function contributionOverview(
  userIds: string[],
  nodes: GNode[],
  override?: Partial<ContributionConfig>,
): Promise<ContributionOverviewRow[]> {
  const config = { ...CONTRIBUTION_ENV, ...override };
  const now = Date.now();
  const rows: ContributionOverviewRow[] = [];
  for (const userId of userIds) {
    const events = await contributionEventsFor(userId, nodes);
    rows.push({ userId, score: aggregateContribution(events, { now, config }) });
  }
  rows.sort((a, b) => b.score.score - a.score.score);
  return rows;
}
