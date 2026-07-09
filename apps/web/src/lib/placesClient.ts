/**
 * Places catalog client — browse restaurants/cafes that exist in the shared
 * catalog (e.g. ingested from OpenStreetMap) but that nobody in your network
 * trusts yet. The cold-start discovery surface: browse → trust one → it enters
 * your trusted network + trust search.
 */
export interface CatalogPlace {
  nodeId: string;
  label: string;
  sub?: string;
  entityType?: string;
  properties?: Record<string, unknown>;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  trusted?: boolean;
}

export interface PlaceTruster {
  id: string;
  name: string;
  confidence: number;
  reasons: string[];
  note?: string;
  outcome: number;
}

export interface PlaceDetail {
  node: {
    id: string;
    label: string;
    sub?: string;
    entityType?: string;
    properties?: Record<string, unknown>;
    lat?: number;
    lng?: number;
    photos?: string[];
  };
  topic?: string;
  distanceKm?: number;
  /** Is this place on the viewer's saved list? */
  saved?: boolean;
  trust: {
    score: number;
    hops: number;
    because: string[];
    count: number;
    iTrust: boolean;
    trusters: PlaceTruster[];
    reasonTally: Record<string, number>;
    outcomes: { positive: number; negative: number; total: number };
  };
  similar: { nodeId: string; label: string; entityType?: string; cuisine?: string[]; distanceKm?: number }[];
  /** Dishes modeled as menu_item nodes PART_OF this place. */
  menu?: MenuItem[];
}

export interface MenuItem {
  nodeId: string;
  label: string;
  price?: string;
  description?: string;
  dietary?: string[];
  image?: string;
}

/** Upload an image → returns its same-origin URL (attach it afterwards). */
export async function uploadMedia(file: File, subdir = "uploads"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("subdir", subdir);
  const r = await fetch("/api/media", { method: "POST", body: fd });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `upload failed (${r.status})`);
  return String((b as { url?: string })?.url ?? "");
}

/** Submit a photo URL for a place → moderation queue (admin approves). */
export async function submitPlacePhoto(id: string, url: string): Promise<void> {
  const r = await fetch(`/api/places/${encodeURIComponent(id)}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `submit failed (${r.status})`);
  }
}

/** Admin: remove a photo from a place's gallery. */
export async function removePlacePhoto(id: string, url: string): Promise<string[]> {
  const r = await fetch(`/api/admin/places/${encodeURIComponent(id)}/photos`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `remove failed (${r.status})`);
  return ((b as { photos?: string[] })?.photos ?? []) as string[];
}

/** Submit a dish for a place's menu → moderation queue (admin approves). */
export async function submitMenuItem(
  id: string,
  dish: { name: string; price?: string; description?: string; dietary?: string[]; image?: string },
): Promise<void> {
  const r = await fetch(`/api/places/${encodeURIComponent(id)}/menu`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dish),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `submit dish failed (${r.status})`);
  }
}

/** Admin: remove a dish from a place's menu. */
export async function removeMenuItem(id: string, dishId: string): Promise<void> {
  const r = await fetch(
    `/api/admin/places/${encodeURIComponent(id)}/menu/${encodeURIComponent(dishId)}`,
    { method: "DELETE" },
  );
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `remove dish failed (${r.status})`);
  }
}

export async function placeDetail(id: string, coords?: { lat: number; lng: number }): Promise<PlaceDetail> {
  const qs = new URLSearchParams();
  if (coords) {
    qs.set("lat", String(coords.lat));
    qs.set("lng", String(coords.lng));
  }
  const r = await fetch(`/api/places/${encodeURIComponent(id)}?${qs.toString()}`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `detail failed (${r.status})`);
  return b as PlaceDetail;
}

/** A place on the viewer's saved list, hydrated with node identity. */
export interface SavedPlace {
  nodeId: string;
  label: string;
  sub?: string;
  entityType?: string;
  properties?: Record<string, unknown>;
  lat?: number;
  lng?: number;
  note?: string;
  savedAt?: string;
}

/** Save / unsave a place to the viewer's list. Returns the new saved state. */
export async function setSaved(id: string, saved: boolean): Promise<boolean> {
  const r = await fetch(`/api/places/${encodeURIComponent(id)}/save`, {
    method: saved ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: saved ? "{}" : undefined,
  });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `save failed (${r.status})`);
  return Boolean((b as { saved?: boolean })?.saved);
}

/** The viewer's saved places (bookmark list). */
export async function listSavedPlaces(): Promise<SavedPlace[]> {
  const r = await fetch(`/api/places/saved/list`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `list failed (${r.status})`);
  return ((b as { places?: SavedPlace[] })?.places ?? []) as SavedPlace[];
}

/** Propose an edit to a place's core fields (goes to the admin moderation queue). */
export async function suggestPlaceEdit(
  id: string,
  patch: Record<string, unknown>,
  note?: string,
): Promise<void> {
  const r = await fetch(`/api/places/${encodeURIComponent(id)}/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patch, note }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `suggest failed (${r.status})`);
  }
}

/* --- admin --- */

export interface PlaceSuggestion {
  id: number;
  placeId: string;
  placeLabel: string;
  userId: string;
  kind: "edit" | "photo" | "menu";
  patch: Record<string, unknown>;
  note?: string;
  status: string;
  createdAt: string;
}

export interface AdminPlace {
  nodeId: string;
  label: string;
  entityType?: string;
  properties?: Record<string, unknown>;
  photos: string[];
  lat?: number;
  lng?: number;
  photoCount: number;
  menuCount: number;
}

export interface PlaceLink {
  id: number;
  url: string;
  source: string;
  status: string;
  nodeId?: string;
  label?: string;
  error?: string;
  submittedBy: string;
  createdAt: string;
}

/** Admin: submit a Google/Yandex Maps link for on-demand import. */
export async function adminSubmitLink(url: string): Promise<{ id: number; source: string }> {
  const r = await fetch(`/api/admin/places/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `submit failed (${r.status})`);
  return b as { id: number; source: string };
}

/** Admin: dismiss a link-history row (does not delete the imported place). */
export async function adminDismissLink(id: number): Promise<void> {
  const r = await fetch(`/api/admin/places/links/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `dismiss failed (${r.status})`);
  }
}

/** Admin: recent submitted links + status. */
export async function adminListLinks(): Promise<PlaceLink[]> {
  const r = await fetch(`/api/admin/places/links`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `list failed (${r.status})`);
  return ((b as { links?: PlaceLink[] })?.links ?? []) as PlaceLink[];
}

/** Admin: the entire places catalog (uncapped) for the management list. */
export async function adminListPlaces(): Promise<AdminPlace[]> {
  const r = await fetch(`/api/admin/places`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `list failed (${r.status})`);
  return ((b as { places?: AdminPlace[] })?.places ?? []) as AdminPlace[];
}

export async function adminUpdatePlace(
  id: string,
  patch: { label?: string; properties?: Record<string, unknown> },
): Promise<void> {
  const r = await fetch(`/api/admin/places/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `update failed (${r.status})`);
  }
}

/** Admin: delete a place (and its menu + edges). */
export async function adminDeletePlace(id: string): Promise<void> {
  const r = await fetch(`/api/admin/places/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `delete failed (${r.status})`);
  }
}

export async function adminListSuggestions(status = "pending"): Promise<PlaceSuggestion[]> {
  const r = await fetch(`/api/admin/place-suggestions?status=${encodeURIComponent(status)}`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `list failed (${r.status})`);
  return ((b as { suggestions?: PlaceSuggestion[] })?.suggestions ?? []) as PlaceSuggestion[];
}

export async function adminReviewSuggestion(sid: number, action: "approve" | "reject"): Promise<void> {
  const r = await fetch(`/api/admin/place-suggestions/${sid}/${action}`, { method: "POST" });
  if (!r.ok) {
    const b = await r.json().catch(() => null);
    throw new Error((b as { error?: string })?.error ?? `${action} failed (${r.status})`);
  }
}

export async function browsePlaces(p: {
  topic: string;
  geo?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
}): Promise<CatalogPlace[]> {
  const qs = new URLSearchParams({ topic: p.topic });
  if (p.geo) qs.set("geo", p.geo);
  if (p.lat != null) qs.set("lat", String(p.lat));
  if (p.lng != null) qs.set("lng", String(p.lng));
  if (p.radiusKm != null) qs.set("radiusKm", String(p.radiusKm));
  if (p.limit != null) qs.set("limit", String(p.limit));
  const r = await fetch(`/api/places?${qs.toString()}`, { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `browse failed (${r.status})`);
  return ((b as { places?: CatalogPlace[] })?.places ?? []) as CatalogPlace[];
}
