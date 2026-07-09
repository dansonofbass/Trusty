/**
 * Signal builder — turns the captured history into the per-node SignalMaps the
 * pure blended scorer consumes. Reads Postgres (search_events, interaction_events,
 * trust_outcomes) and projects onto the candidate graph passed in the request.
 *
 * Everything is best-effort: a query failure yields empty maps, and the blend
 * gracefully falls back toward pure structural scoring.
 */
import pg from "pg";
import {
  TOPIC_PARENT,
  normalizeTopic,
  topicForEntityType,
  type GNode,
  type SignalMaps,
} from "@constellation/graph-core";

const HALF_LIFE_DAYS = Number(process.env.AFFINITY_HALF_LIFE_DAYS ?? 30);
const decay = (ageMs: number): number => Math.pow(0.5, ageMs / 86_400_000 / HALF_LIFE_DAYS);
const roll = (t: string): string => TOPIC_PARENT[t] ?? t;
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Build the personalization signals for one user over the candidate `nodes`.
 * - topicAffinity: recency-decayed interest by the node's taste clusters +
 *   ontology topic, from what the user has engaged with + searched.
 * - communityBoost: node in the viewer's Louvain community.
 * - outcomeSignal: global provider quality (avg outcome per trusted node).
 * - fatigue: recency-decayed impressions/dismisses per node.
 */
export async function buildSignalMaps(
  pool: pg.Pool,
  userId: string,
  nodes: GNode[],
  communityByNode: Record<string, number>,
): Promise<SignalMaps> {
  const now = Date.now();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const clusterW = new Map<string, number>();
  const topicW = new Map<string, number>();
  const fatigueRaw = new Map<string, number>();
  const outcomeSignal = new Map<string, number>();

  // Interactions → affinity (by the engaged node's clusters/topic) + fatigue.
  const inter = await pool.query(
    `SELECT node_id, kind, weight, extract(epoch from at)*1000 AS at_ms
       FROM interaction_events
      WHERE user_id = $1 AND at > now() - interval '90 days'`,
    [userId],
  );
  for (const r of inter.rows) {
    const w = Number(r.weight) * decay(now - Number(r.at_ms));
    const node = nodeById.get(r.node_id as string);
    if (node && w !== 0) {
      for (const c of node.clusters ?? []) clusterW.set(c, (clusterW.get(c) ?? 0) + w);
      const t = node.entityType ? topicForEntityType(node.entityType) : undefined;
      if (t) topicW.set(roll(t), (topicW.get(roll(t)) ?? 0) + w);
    }
    if (r.kind === "impression" || r.kind === "dismiss") {
      const pen = (r.kind === "dismiss" ? 3 : 1) * decay(now - Number(r.at_ms));
      fatigueRaw.set(r.node_id as string, (fatigueRaw.get(r.node_id as string) ?? 0) + pen);
    }
  }

  // Searches → topic interest.
  const searches = await pool.query(
    `SELECT topic, extract(epoch from at)*1000 AS at_ms
       FROM search_events
      WHERE user_id = $1 AND topic IS NOT NULL AND at > now() - interval '90 days'`,
    [userId],
  );
  for (const r of searches.rows) {
    const t = roll(normalizeTopic(r.topic as string));
    if (t) topicW.set(t, (topicW.get(t) ?? 0) + decay(now - Number(r.at_ms)));
  }

  // Outcomes → global provider quality (verified feedback), per trusted node.
  const outc = await pool.query(
    `SELECT to_id, avg(value) AS v FROM trust_outcomes WHERE to_id IS NOT NULL GROUP BY to_id`,
  );
  for (const r of outc.rows) outcomeSignal.set(r.to_id as string, clamp1(Number(r.v)));

  // Normalize cluster/topic weights to [0,1] by their max.
  const maxOf = (m: Map<string, number>) => {
    let mx = 0;
    for (const v of m.values()) mx = Math.max(mx, v);
    return mx > 0 ? mx : 1;
  };
  const cMax = maxOf(clusterW);
  const tMax = maxOf(topicW);

  const topicAffinity = new Map<string, number>();
  for (const n of nodes) {
    let a = 0;
    for (const c of n.clusters ?? []) a = Math.max(a, Math.max(0, clusterW.get(c) ?? 0) / cMax);
    const t = n.entityType ? topicForEntityType(n.entityType) : undefined;
    if (t) a = Math.max(a, Math.max(0, topicW.get(roll(t)) ?? 0) / tMax);
    if (a > 0) topicAffinity.set(n.id, a);
  }

  const viewerCommunity = communityByNode[userId];
  const communityBoost = new Map<string, number>();
  if (viewerCommunity !== undefined) {
    for (const n of nodes) if (communityByNode[n.id] === viewerCommunity) communityBoost.set(n.id, 1);
  }

  const fatigue = new Map<string, number>();
  for (const [id, raw] of fatigueRaw) fatigue.set(id, 1 - Math.exp(-raw / 3));

  return { topicAffinity, communityBoost, outcomeSignal, fatigue };
}
