/** Topic-ranked specialist search — same-origin BFF route, thin wrapper. */

export interface SpecialistCard {
  nodeId: string;
  label: string;
  nodeType: string;
  verified: boolean;
  trustLabel: string;
  trustLabelText: string;
  telegramHandle?: string;
  photoUrl?: string;
  karma?: number;
  /** Why a card ranks where it does: trust tier vs. the bounded karma lift
   *  (see KARMA_RANK_WEIGHT in graph-service). Surfaced so a surprising order
   *  can be explained rather than guessed at. */
  rankBasis?: { trust: number; karma: number; karmaWeight: number };
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

export async function fetchSpecialistsByTopic(topic: string, limit = 8): Promise<SpecialistCard[]> {
  const r = await fetch(`/api/specialists?topic=${encodeURIComponent(topic)}&limit=${limit}`, { cache: "no-store" });
  const data = (await jsonOrThrow(r)) as { specialists: SpecialistCard[] };
  return data.specialists;
}

/** Best-effort merge across several topics, deduped, most-trusted first —
 *  used where there's no single topic filter (e.g. a community's "ask an
 *  expert" section spanning several professions). */
export async function fetchSpecialistsByTopics(topics: string[], limitEach = 6): Promise<SpecialistCard[]> {
  const lists = await Promise.all(topics.map((t) => fetchSpecialistsByTopic(t, limitEach).catch(() => [])));
  const byId = new Map<string, SpecialistCard>();
  for (const list of lists) for (const s of list) if (!byId.has(s.nodeId)) byId.set(s.nodeId, s);
  const RANK: Record<string, number> = { highly_reliable: 4, reliable: 3, established: 2, emerging: 1, limited_evidence: 0 };
  return [...byId.values()].sort((a, b) => (RANK[b.trustLabel] ?? 0) - (RANK[a.trustLabel] ?? 0));
}

/** Cards for an explicit id list — a circle's admin-pinned mentors. */
export async function fetchSpecialistCardsByIds(ids: string[]): Promise<SpecialistCard[]> {
  if (!ids.length) return [];
  const r = await fetch("/api/specialists/cards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = (await jsonOrThrow(r)) as { specialists: SpecialistCard[] };
  return data.specialists;
}

export function telegramUrl(handle: string): string {
  return `https://t.me/${handle.replace(/^@/, "")}`;
}

/** Persian labels — shared by the survey results screen and the Experts page's
 *  Experts section, the two Persian-first surfaces that render specialist
 *  cards. `nodeType`/`trustLabel` are stable enum keys from graph-core. */
export const SPECIALIST_TYPE_FA: Record<string, string> = {
  lawyer: "وکیل",
  broker: "مشاور املاک",
  immigration_consultant: "مشاور مهاجرت",
  accountant: "حسابدار",
  doctor: "پزشک",
  dentist: "دندون‌پزشک",
  mechanic: "مکانیک",
  plumber: "لوله‌کش",
  electrician: "برق‌کار",
};

export const TRUST_LABEL_FA: Record<string, string> = {
  limited_evidence: "شواهد کم",
  emerging: "در حال شکل‌گیری",
  established: "شناخته‌شده",
  reliable: "قابل‌اعتماد",
  highly_reliable: "به‌شدت قابل‌اعتماد",
};
