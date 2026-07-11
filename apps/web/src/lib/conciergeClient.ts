/**
 * Concierge answer stream — shared by the Sevan directory search and the
 * main-app Trust Search. Pipes the extractor's SSE tokens to `onToken`.
 */

/** A light, non-creepy summary of the viewer so the concierge can tailor answers. */
export interface ViewerContext {
  role?: string;
  skills?: string[];
  sectors?: string[];
  venture?: string;
}

export interface AnswerResult {
  label: string;
  entityType?: string;
  sub?: string;
  matchPct?: number;
  reasons?: string[];
}

/** Stream the concierge answer; calls onToken per chunk. Resolves when done.
 *  `mode` picks the concierge persona: "trust" (main app) or "sevan" (event). */
export async function streamConciergeAnswer(
  query: string,
  results: AnswerResult[],
  onToken: (t: string) => void,
  viewer?: ViewerContext,
  mode: "trust" | "sevan" = "sevan",
): Promise<void> {
  const r = await fetch("/api/sevan/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, results, viewer, mode }),
  });
  if (!r.ok || !r.body) throw new Error(`answer stream failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as { type: string; content?: string };
        if (ev.type === "token" && ev.content) onToken(ev.content);
      } catch { /* skip malformed */ }
    }
  }
}
