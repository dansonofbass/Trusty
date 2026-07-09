/**
 * Vector similarity — the pure math behind semantic topic matching (Feature 9).
 *
 * Embeddings (BGE-M3) and their storage (pgvector) live server-side, but the
 * arithmetic is pure and everything depends on it, so it lives here and is
 * tested. graph-service embeds topics, calls `topicsWithinThreshold`, and hands
 * the result to the trust engine as `TrustQuery.expandedTopics` — the engine
 * itself stays deterministic and I/O-free.
 */

/** Cosine similarity of two equal-length vectors, in [-1, 1] (0 if degenerate). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * From candidate `{topic, vec}` pairs, the topics whose embedding is at least
 * `threshold` cosine-similar to `queryVec` — the semantic neighbourhood of a
 * search (e.g. "dentist" pulls in "orthodontist"). Sorted most-similar first.
 */
export function topicsWithinThreshold(
  queryVec: number[],
  candidates: Array<{ topic: string; vec: number[] }>,
  threshold: number,
): string[] {
  return candidates
    .map((c) => ({ topic: c.topic, sim: cosineSimilarity(queryVec, c.vec) }))
    .filter((c) => c.sim >= threshold)
    .sort((a, b) => b.sim - a.sim)
    .map((c) => c.topic);
}
