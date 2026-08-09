/**
 * Sessions with specialists: their weekly availability, the concrete slots it
 * generates, and booking one.
 *
 * Slots are UTC on the wire and rendered in the viewer's own zone — an expert
 * in Yerevan and someone asking from Tehran must not see different times for
 * the same session.
 */

export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "open" | "booked" | "cancelled";
  bookedBy?: string;
}

/** A weekly pattern: "every Tuesday 18:00–20:00, in 30-minute sessions". */
export interface AvailabilityRule {
  id?: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes past midnight, UTC. */
  startMinute: number;
  endMinute: number;
  sessionMinutes: number;
}

export interface SessionPrice {
  amount: number;
  currency: string;
}

export interface SlotsPage {
  slots: Slot[];
  canManage: boolean;
  verified: boolean;
  availability: AvailabilityRule[];
  price: SessionPrice | null;
}

/** A specialist the chat can offer a booking for, right in the thread. */
export interface BookableExpert {
  nodeId: string;
  label: string;
  nodeType: string;
  verified: boolean;
  trustLabel: string;
  trustLabelText: string;
  photoUrl?: string;
  slots: Slot[];
  price: SessionPrice | null;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

const enc = encodeURIComponent;

export const fetchSlots = (nodeId: string): Promise<SlotsPage> =>
  fetch(`/api/specialists/${enc(nodeId)}/slots`, { cache: "no-store" }).then(jsonOrThrow) as Promise<SlotsPage>;

export const saveAvailability = (nodeId: string, rules: AvailabilityRule[]) =>
  fetch(`/api/specialists/${enc(nodeId)}/availability`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules }),
  }).then(jsonOrThrow) as Promise<{ ok: true; rules: AvailabilityRule[]; created: number }>;

export const saveSessionPrice = (nodeId: string, amount: number, currency: string) =>
  fetch(`/api/specialists/${enc(nodeId)}/session-price`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount, currency }),
  }).then(jsonOrThrow) as Promise<{ ok: true; price: SessionPrice | null }>;

export const bookSlot = (nodeId: string, slotId: string, note?: string) =>
  fetch(`/api/specialists/${enc(nodeId)}/slots/${enc(slotId)}/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  }).then(jsonOrThrow) as Promise<{ ok: true; slot: Slot }>;

export const fetchBookableExperts = (topic: string): Promise<{ topic: string; experts: BookableExpert[] }> =>
  fetch(`/api/experts/bookable?topic=${enc(topic)}`, { cache: "no-store" }).then(jsonOrThrow) as Promise<{
    topic: string;
    experts: BookableExpert[];
  }>;

/* ------------------------------ formatting ----------------------------- */

/** A slot's day + time in the viewer's locale and zone. */
export const formatSlot = (iso: string, locale: string): string =>
  new Date(iso).toLocaleString(locale === "fa" ? "fa-IR" : locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Just the clock part — the day is shown once per group. */
export const formatSlotTime = (iso: string, locale: string): string =>
  new Date(iso).toLocaleTimeString(locale === "fa" ? "fa-IR" : locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatSlotDay = (iso: string, locale: string): string =>
  new Date(iso).toLocaleDateString(locale === "fa" ? "fa-IR" : locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export const formatPrice = (p: SessionPrice, locale: string): string =>
  `${p.amount.toLocaleString(locale === "fa" ? "fa-IR" : locale)} ${p.currency}`;

/** "18:00" ⇄ minutes-past-midnight, for the availability editor. */
export const minutesToHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const hhmmToMinutes = (v: string): number => {
  const [h, m] = v.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
