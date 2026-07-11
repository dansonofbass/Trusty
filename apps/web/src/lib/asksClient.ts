/**
 * Ask-my-network client (BFF → graph-service). Broadcast an ask when search is
 * empty; answer a friend's ask (which creates your trust edge).
 */

export interface AskAnswer {
  id: string;
  responderId: string;
  nodeId: string;
  edgeId?: string;
  note?: string;
  createdAt: string;
  providerLabel: string;
  responderName: string;
}

export interface MyAsk {
  id: string;
  topic: string;
  geo?: string;
  note?: string;
  status: string;
  createdAt: string;
  answers: AskAnswer[];
}

export interface InboxAsk {
  id: string;
  askerId: string;
  askerName: string;
  topic: string;
  geo?: string;
  note?: string;
  createdAt: string;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

/** Append ?app= so asks stay scoped to the space they were raised in. */
const appQ = (app?: string) => (app ? `?app=${encodeURIComponent(app)}` : "");

export async function createAsk(
  input: { topic: string; geo?: string; note?: string },
  app?: string,
): Promise<MyAsk> {
  const r = await fetch(`/api/asks${appQ(app)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await jsonOrThrow(r)) as MyAsk;
}

export async function myAsks(app?: string): Promise<MyAsk[]> {
  const r = await fetch(`/api/asks/mine${appQ(app)}`, { cache: "no-store" });
  return (await jsonOrThrow(r)) as MyAsk[];
}

export async function askInbox(app?: string): Promise<InboxAsk[]> {
  const r = await fetch(`/api/asks/inbox${appQ(app)}`, { cache: "no-store" });
  return (await jsonOrThrow(r)) as InboxAsk[];
}

export async function answerAsk(
  id: string,
  input: { label?: string; nodeId?: string; note?: string },
  app?: string,
): Promise<{ ok: boolean; nodeId?: string; reason?: string }> {
  const r = await fetch(`/api/asks/${encodeURIComponent(id)}/answer${appQ(app)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await jsonOrThrow(r)) as { ok: boolean; nodeId?: string; reason?: string };
}
