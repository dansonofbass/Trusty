/**
 * Relationship Strength — a DERIVED, per-(viewer→person) tie weight for
 * PERSONALIZATION ONLY. It answers "how personally meaningful is this person's
 * opinion to me?" and is frozen by Doc #9 to be independent of everything else:
 *
 *   - NEVER trust (it modulates how much trust flows across MY friendships, but
 *     never creates trust or changes a trust score).
 *   - NEVER reputation (a close friend can have low topic reputation).
 *   - NEVER user-editable — it's a latent variable derived from evidence.
 *
 * Signals (all decayed, evolving): a weak category prior from the edge type
 * (FRIENDS_WITH / SAVED / INVITED — categories are weak initial priors that
 * evolve, #9), plus recency-weighted interaction history with that person. Absent
 * DB ⇒ priors only (and a plain friend prior equals the legacy FRIEND_TRUST, so
 * trust transfer is unchanged).
 */
import pg from "pg";
import type { GLink } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

const HALF_LIFE_DAYS = Number(process.env.REL_STRENGTH_HALF_LIFE_DAYS ?? 60) || 60;
const INTERACTION_MAX_BOOST = 0.4; // interactions can lift a tie this far above its prior

/**
 * Weak category priors. FRIENDS_WITH == the legacy FRIEND_TRUST (0.45) so a
 * friendship with no other evidence transfers trust exactly as before. INVITED
 * is lower — an invite is an initial pathway, NOT trust (#6/#9).
 */
const EDGE_PRIOR: Record<string, number> = {
  FRIENDS_WITH: 0.45,
  SAVED: 0.35,
  INVITED: 0.3,
};

const endId = (v: string | { id: string }): string => (typeof v === "string" ? v : v.id);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function relationshipStrengthEnabled(): boolean {
  return !!pool;
}

export async function initRelationshipStrength(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — relationship strength = priors only");
    return;
  }
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  console.log("graph-service: relationship strength ready (postgres, derived)");
}

/**
 * The viewer's relationship-strength map: personId → strength [0,1]. Built from
 * the viewer's personal edges (category prior) lifted by recency-weighted
 * interaction history. Only people the viewer has SOME tie to appear.
 */
export async function strengthMap(viewerId: string, links: GLink[]): Promise<Map<string, number>> {
  // 1. Category priors from the viewer's own edges.
  const prior = new Map<string, number>();
  for (const l of links) {
    const p = EDGE_PRIOR[l.type];
    if (p === undefined) continue;
    const s = endId(l.source);
    const t = endId(l.target);
    const other = s === viewerId ? t : t === viewerId ? s : null;
    if (!other) continue;
    prior.set(other, Math.max(prior.get(other) ?? 0, p));
  }
  if (prior.size === 0) return prior;

  // 2. Recency-weighted interaction boost with those people.
  const boost = new Map<string, number>();
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT node_id, weight, extract(epoch from at)*1000 AS at_ms
           FROM interaction_events
          WHERE user_id = $1 AND node_id = ANY($2) AND at > now() - interval '365 days'`,
        [viewerId, [...prior.keys()]],
      );
      const now = Date.now();
      for (const row of r.rows) {
        const ageDays = Math.max(0, (now - Number(row.at_ms)) / 86_400_000);
        const w = Number(row.weight ?? 1) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
        boost.set(row.node_id as string, (boost.get(row.node_id as string) ?? 0) + w);
      }
    } catch {
      /* best-effort — fall back to priors only */
    }
  }

  // 3. Combine: prior lifted by a saturating interaction boost, clamped [0,1].
  const out = new Map<string, number>();
  for (const [personId, base] of prior) {
    const raw = boost.get(personId) ?? 0;
    const lift = INTERACTION_MAX_BOOST * (1 - Math.exp(-raw / 3));
    out.set(personId, clamp01(base + lift));
  }
  return out;
}
