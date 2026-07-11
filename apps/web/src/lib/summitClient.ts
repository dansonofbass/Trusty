/** Summit app data client — talks to the app-scoped BFF endpoints. */
import type { GNode, MeetSuggestion } from "@constellation/graph-core";

export const SUMMIT_APP = "summit";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `request failed (${r.status})`);
  return b as T;
}
async function jsend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `request failed (${r.status})`);
  return b as T;
}

export type Profile = GNode;
export interface MeetCard extends MeetSuggestion {
  node: GNode;
}

export const getMyProfile = () => jget<{ node: GNode | null }>("/api/profile").then((r) => r.node);

export const saveMyProfile = (input: {
  /** Active roles, primary first (one person, many roles). */
  roles?: string[];
  entityType?: string;
  label?: string;
  properties: Record<string, unknown>;
}) => jsend<{ _profile: GNode }>("/api/profile", "POST", input).then((r) => r._profile);

export const getDirectory = (opts: { type?: string; q?: string; skill?: string } = {}) => {
  const p = new URLSearchParams({ app: SUMMIT_APP });
  if (opts.type) p.set("type", opts.type);
  if (opts.q) p.set("q", opts.q);
  if (opts.skill) p.set("skill", opts.skill);
  return jget<{ nodes: GNode[]; count: number }>(`/api/directory?${p}`);
};

export const getWhoToMeet = (skill?: string, mode?: string) => {
  const p = new URLSearchParams({ app: SUMMIT_APP });
  if (skill) p.set("skill", skill);
  if (mode) p.set("mode", mode);
  return jget<{ suggestions: MeetCard[] }>(`/api/who-to-meet?${p}`).then((r) => r.suggestions ?? []);
};

/** One Home-feed row ("People to meet today", "Potential API customers", …). */
export interface HomeSection {
  id: string;
  title: string;
  items: { nodeId: string; node: GNode; matchPct?: number; reasons?: string[] }[];
}

export const getHome = () =>
  jget<{ sections: HomeSection[] }>(`/api/home?app=${SUMMIT_APP}`).then((r) => r.sections ?? []);

export const getDirectoryFiltered = (
  filters: { type?: string; q?: string; industry?: string; tech?: string; country?: string; stage?: string; skill?: string } = {},
) => {
  const p = new URLSearchParams({ app: SUMMIT_APP });
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  return jget<{ nodes: GNode[]; count: number }>(`/api/directory?${p}`);
};

/* Bookmark labels + the meeting lifecycle (F3/F6). */
export const CONTACT_LABELS = [
  { id: "interesting", label: "Interesting" },
  { id: "need_follow_up", label: "Need follow-up" },
  { id: "potential_partner", label: "Potential partner" },
  { id: "potential_customer", label: "Potential customer" },
  { id: "potential_investor", label: "Potential investor" },
  { id: "potential_mentor", label: "Potential mentor" },
  { id: "potential_api_user", label: "Potential API user" },
] as const;

export const LIFECYCLE_STAGES = [
  "discovered", "interested", "met", "conversation", "follow_up",
  "opportunity", "pilot", "partnership", "long_term", "trust",
] as const;

export interface ContactItem {
  node: GNode;
  label: string;
  labels: string[];
  stage: string;
}

export const getContacts = () => jget<{ nodes: GNode[] }>("/api/contacts").then((r) => r.nodes ?? []);
export const getContactItems = () => jget<{ items: ContactItem[] }>("/api/contacts").then((r) => r.items ?? []);
/** Save a contact with one or more reason tags. Accepts a single label or an array. */
export const saveContact = (targetId: string, labels?: string | string[], stage?: string) =>
  jsend("/api/contacts", "POST", { targetId, labels: labels == null ? [] : Array.isArray(labels) ? labels : [labels], stage });
export const removeContact = (id: string) => jsend(`/api/contacts/${encodeURIComponent(id)}`, "DELETE");
export const setContactStage = (id: string, stage: string) =>
  jsend(`/api/contacts/${encodeURIComponent(id)}/stage`, "POST", { stage });

export interface Meeting {
  id: string;
  requesterId: string;
  targetId: string;
  requesterLabel: string;
  targetLabel: string;
  kind: string;
  /** Proposed date/time (from the datetime picker, e.g. "2026-07-28T15:30"). */
  slot?: string;
  /** Venue — a predefined location or a custom description. */
  location?: string;
  note?: string;
  status: string;
}

export const requestMeeting = (input: { targetId: string; kind: string; slot?: string; location?: string; note?: string }) =>
  jsend<Meeting>("/api/meetings", "POST", input);

/** Predefined meeting venues (admin-managed in /admin/apps). */
export interface EventLocation {
  id: string;
  app: string;
  label: string;
  ord: number;
}
export const getLocations = () =>
  jget<{ locations: EventLocation[] }>(`/api/locations?app=${SUMMIT_APP}`).then((r) => r.locations ?? []);

/** Format a picker slot ("2026-07-28T15:30") for display; passes through free text. */
export const formatSlot = (slot?: string): string => {
  if (!slot) return "";
  const d = new Date(slot);
  if (Number.isNaN(d.getTime())) return slot;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
export const getMeetings = () => jget<{ incoming: Meeting[]; outgoing: Meeting[] }>("/api/meetings");
export const respondMeeting = (id: string, action: "confirm" | "decline") =>
  jsend<Meeting>(`/api/meetings/${encodeURIComponent(id)}/${action}`, "POST", {});

/* Meeting notes (F5/v2) — text with a visibility; confirmed entities → edges. */
export type NoteVisibility = "private" | "connections" | "public";

export interface NoteEntity {
  name: string;
  kind: string;
}
export interface NoteRelation {
  source: string;
  target: string;
  label: string;
}
export interface MeetingNoteRecord {
  id: string;
  targetId: string;
  text: string;
  extraction?: { entities: NoteEntity[]; relations?: NoteRelation[] };
  visibility: NoteVisibility;
  photos?: string[];
  createdAt: string;
}
/** A journal entry (my note, hydrated with who it's about). */
export interface MyNote extends MeetingNoteRecord {
  targetLabel: string;
}
/** A community note shown on someone's profile. */
export interface CommunityNote extends MeetingNoteRecord {
  authorLabel: string;
  mine: boolean;
}

export const saveNote = (
  targetId: string,
  text: string,
  entities: NoteEntity[],
  visibility: NoteVisibility = "private",
  relations: NoteRelation[] = [],
  photos: string[] = [],
) => jsend<{ _note: { id: string } }>("/api/notes", "POST", { targetId, text, entities, relations, visibility, photos });
export const updateNoteApi = (
  id: string,
  patch: { text?: string; entities?: NoteEntity[]; relations?: NoteRelation[]; visibility?: NoteVisibility; photos?: string[] },
) => jsend<{ _note: MeetingNoteRecord }>(`/api/notes/${encodeURIComponent(id)}`, "PUT", patch);

/** Upload an image (reuses the BFF uploads volume) → same-origin URL. */
export async function uploadImage(file: File, subdir = "notes"): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("subdir", subdir);
  const r = await fetch("/api/media", { method: "POST", body: form });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `upload failed (${r.status})`);
  return (b as { url: string }).url;
}
export const deleteNoteApi = (id: string) => jsend(`/api/notes/${encodeURIComponent(id)}`, "DELETE");
export const getMyNotes = () => jget<{ notes: MyNote[] }>("/api/notes/mine").then((r) => r.notes ?? []);
export const getNotesAbout = (targetId: string) =>
  jget<{ notes: CommunityNote[] }>(`/api/notes/about/${encodeURIComponent(targetId)}`).then((r) => r.notes ?? []);
export const getHistory = (targetId: string) =>
  jget<{ notes: MeetingNoteRecord[]; meetings: Meeting[] }>(`/api/contacts/${encodeURIComponent(targetId)}/history`);

/* Agent search — NL query → filters + streamed concierge answer. */
export interface SevanFilters {
  type?: string;
  industry?: string;
  tech?: string;
  country?: string;
  stage?: string;
  skill?: string;
}

export const resolveSevanQuery = (query: string, vocab: Record<string, string[]>) =>
  jsend<{ filters: SevanFilters; via: string }>("/api/sevan/query", "POST", { query, vocab });

/** A light, non-creepy summary of the viewer so the concierge can tailor answers. */
export interface ViewerContext {
  role?: string;
  skills?: string[];
  sectors?: string[];
  venture?: string;
}

/** Stream the concierge answer; calls onToken per chunk. Resolves when done. */
export async function streamSevanAnswer(
  query: string,
  results: { label: string; entityType?: string; sub?: string; matchPct?: number; reasons?: string[] }[],
  onToken: (t: string) => void,
  viewer?: ViewerContext,
): Promise<void> {
  const r = await fetch("/api/sevan/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, results, viewer }),
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

/* Programme (F7) — workshops/sessions + attendance. */
export interface ProgrammeItem {
  node: GNode;
  attendees: number;
  attending: boolean;
}
export const getProgramme = () =>
  jget<{ items: ProgrammeItem[] }>(`/api/programme?app=${SUMMIT_APP}`).then((r) => r.items ?? []);
export const setAttending = (workshopId: string, off = false) => jsend("/api/attend", "POST", { workshopId, off });
