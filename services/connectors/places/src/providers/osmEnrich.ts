/**
 * Keyless enrichment for link imports. Google/Yandex block server-side scraping
 * (Yandex serves a captcha), and their share URLs carry only a name + maybe
 * coordinates. But the SAME restaurant almost always exists in OpenStreetMap —
 * so we look it up there and reuse the OSM tag mapping to fill
 * cuisine/hours/phone/amenities/etc. Best-effort, no API key.
 *
 *  - **With coordinates** (Google links, Yandex share links with ?ll=): an
 *    Overpass "around" query finds the nearest food venue to the marker — precise.
 *  - **Name only** (Yandex org URLs): a Nominatim name search — fuzzy, and for a
 *    chain may pick the wrong branch (admin can correct).
 *
 * Nominatim/Overpass usage policy: light, single-shot lookups — link imports are
 * occasional, which fits. Descriptive User-Agent required.
 */
import type { Place } from "../types";
import { mapTags } from "./osm";

const NOMINATIM = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search";
const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const UA = "Trusty-Places/0.1 (trust-graph restaurant catalog)";
const FOOD = "^(restaurant|cafe|bar|pub|fast_food|food_court)$";

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type Enrichment = Partial<
  Pick<Place, "cuisine" | "dietary" | "amenities" | "mealTypes" | "capacity" | "outdoorSeating" | "reservations" | "hours" | "address" | "phone" | "website" | "photos" | "geo" | "lat" | "lng">
>;

const fromTags = (tags: Record<string, string>, lat: number, lng: number): Enrichment => {
  const f = mapTags(tags);
  return {
    lat, lng,
    cuisine: f.cuisine, dietary: f.dietary, amenities: f.amenities, mealTypes: f.mealTypes, capacity: f.capacity,
    outdoorSeating: f.outdoorSeating, reservations: f.reservations,
    hours: f.hours, address: f.address, phone: f.phone, website: f.website, photos: f.photos, geo: f.geo,
  };
};

/** Precise: the nearest OSM food venue to the marker coordinates (≤ 70 m). */
async function byCoords(lat: number, lng: number): Promise<Enrichment | null> {
  const q =
    `[out:json][timeout:25];(` +
    `node["amenity"~"${FOOD}"](around:70,${lat},${lng});` +
    `way["amenity"~"${FOOD}"](around:70,${lat},${lng});` +
    `);out center tags 20;`;
  let els: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }>;
  try {
    const r = await fetch(OVERPASS, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ data: q }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    els = ((await r.json()) as { elements?: typeof els }).elements ?? [];
  } catch {
    return null;
  }
  const cand = els
    .map((e) => ({ tags: e.tags ?? {}, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon }))
    .filter((e): e is { tags: Record<string, string>; lat: number; lng: number } => typeof e.lat === "number" && typeof e.lng === "number" && !!e.tags.name);
  if (!cand.length) return null;
  cand.sort((a, b) => haversine({ lat, lng }, a) - haversine({ lat, lng }, b));
  return fromTags(cand[0].tags, cand[0].lat, cand[0].lng);
}

interface NominatimResult {
  lat: string; lon: string; class?: string; type?: string;
  display_name?: string; address?: Record<string, string>; extratags?: Record<string, string>;
}

/** Fuzzy: name search (no coords). May pick the wrong branch of a chain. */
async function byName(name: string): Promise<Enrichment | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(name)}&format=jsonv2&extratags=1&addressdetails=1&limit=8`;
  let results: NominatimResult[];
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    results = (await r.json()) as NominatimResult[];
  } catch {
    return null;
  }
  const food = results.filter((x) => (x.class === "amenity" && /restaurant|cafe|bar|pub|fast_food/.test(x.type ?? "")) || x.extratags?.cuisine);
  const pick = food[0];
  if (!pick) return null;
  const e = fromTags(pick.extratags ?? {}, Number(pick.lat), Number(pick.lon));
  const addr = pick.address ?? {};
  e.address = e.address || [addr.house_number, addr.road, addr.city || addr.town].filter(Boolean).join(", ") || undefined;
  e.geo = e.geo || (addr.city || addr.town || addr.suburb)?.toLowerCase().replace(/\s+/g, "_");
  return e;
}

/** Enrich a link import from OSM — by coordinates if we have them, else by name. */
export async function enrichFromOsm(opts: { name: string; lat?: number; lng?: number }): Promise<Enrichment | null> {
  const here = typeof opts.lat === "number" && typeof opts.lng === "number" && (opts.lat !== 0 || opts.lng !== 0);
  if (here) {
    const byLoc = await byCoords(opts.lat!, opts.lng!);
    if (byLoc) return byLoc;
  }
  if (opts.name.trim()) return byName(opts.name.trim());
  return null;
}
