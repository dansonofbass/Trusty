/**
 * "Which circle does this question belong in?"
 *
 * Ranking happens server-side over the space's real circles, their curated tag
 * vocabularies and the tags already in use on their questions. It comes back
 * with machine-readable `reasons` rather than prose so the UI can explain the
 * pick in the reader's own language — and so a wrong pick is obvious.
 */

export interface CircleCandidate {
  circleId: string;
  label: string;
  score: number;
  reasons: { kind: string; value?: string; count?: number }[];
  postCount: number;
  mine: boolean;
  open: boolean;
  suggestedTags: string[];
  /** Curated tags the question text matched — carried onto the post. */
  matchedTags: string[];
}

export async function routeQuestion(text: string): Promise<CircleCandidate[]> {
  const r = await fetch("/api/forum/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return (body as { candidates?: CircleCandidate[] })?.candidates ?? [];
}
