/**
 * Interaction client — batches impression/click events for the recommender's
 * fatigue/CTR signals. Fire-and-forget, deduped, flushed on a short debounce so
 * we never spam the BFF. No-op if the batch is empty.
 */

type Ev = { nodeId: string; kind: "impression" | "click"; topic?: string };

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set<string>(); // dedupe impressions within a session

async function flush() {
  timer = null;
  const events = queue;
  queue = [];
  if (events.length === 0) return;
  try {
    await fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    /* best-effort telemetry */
  }
}

function enqueue(ev: Ev) {
  queue.push(ev);
  if (!timer) timer = setTimeout(flush, 4000);
}

/** Log that these rec nodes were shown to the user (once each per session). */
export function logImpressions(nodeIds: string[]) {
  for (const nodeId of nodeIds) {
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    enqueue({ nodeId, kind: "impression" });
  }
}

/** Log that the user clicked/opened a recommended node. */
export function logClick(nodeId: string, topic?: string) {
  if (!nodeId) return;
  enqueue({ nodeId, kind: "click", topic });
}
