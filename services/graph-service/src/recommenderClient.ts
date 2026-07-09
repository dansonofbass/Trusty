/**
 * Optional delegation of recommendation scoring to the recommender service.
 * Node sizes stay inline; only the frontier list is fetched remotely so Phase 3
 * can swap in pgvector + PageRank without touching graph-service.
 */
import {
  computeRecommendations,
  recomputeVals,
  refreshDerived,
  type Dataset,
} from "@constellation/graph-core";

const getRecommenderUrl = () => process.env.RECOMMENDER_URL?.replace(/\/+$/, "");

export function recommenderConfigured(): boolean {
  return Boolean(getRecommenderUrl());
}

/** Recompute vals locally; fetch BLENDED recommendations from the recommender
 *  when configured. `communityByNode` feeds the community signal; on any failure
 *  we fall back to inline structural scoring so recs are never empty. */
export async function applyRecommendations(
  d: Dataset,
  opts: { communityByNode?: Record<string, number> } = {},
): Promise<Dataset> {
  recomputeVals(d.nodes, d.links);
  const RECOMMENDER_URL = getRecommenderUrl();
  if (!RECOMMENDER_URL) {
    return {
      ...d,
      recommendations: computeRecommendations(d.nodes, d.links, d.meId, {
        dismissed: d.dismissed,
      }),
    };
  }
  try {
    const r = await fetch(`${RECOMMENDER_URL}/recompute/${encodeURIComponent(d.meId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodes: d.nodes,
        links: d.links,
        dismissed: d.dismissed ?? [],
        communityByNode: opts.communityByNode ?? {},
      }),
    });
    const body = (await r.json().catch(() => null)) as {
      recommendations?: Dataset["recommendations"];
      error?: string;
    } | null;
    if (!r.ok) throw new Error(body?.error ?? `recommender ${r.status}`);
    return { ...d, recommendations: body?.recommendations ?? [] };
  } catch (e) {
    console.warn(
      "recommender unavailable — falling back to inline scoring:",
      e instanceof Error ? e.message : e,
    );
    return refreshDerived(d);
  }
}
