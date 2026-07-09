/**
 * Outcome client — the productized "did it work out?" loop (BFF → graph-service).
 * markIntent when a user acts on a provider; the follow-up prompt appears later.
 */

export interface PendingPrompt {
  id: string;
  nodeId: string;
  edgeId?: string;
  topic?: string;
  geo?: string;
  label: string;
  createdAt: string;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

/** Record intent to use a provider — schedules a "did it work out?" prompt. */
export async function markIntent(input: {
  nodeId: string;
  edgeId?: string;
  topic?: string;
  geo?: string;
}): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/outcomes/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function listPendingOutcomes(): Promise<PendingPrompt[]> {
  const r = await fetch("/api/outcomes", { cache: "no-store" });
  return (await jsonOrThrow(r)) as PendingPrompt[];
}

/** Resolve a prompt. value: +1 worked · -1 didn't · 0 dismissed. */
export async function resolveOutcome(id: string, value: number): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/outcomes/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, value }),
    }),
  );
}
