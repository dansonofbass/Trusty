/**
 * Google Maps provider — resolves a single place/share URL into a Place.
 *
 * Two paths:
 *  - **Keyless (default):** follow the share-link redirect to the canonical maps
 *    URL and parse the name + coordinates + a stable id out of it. Enough to
 *    create/locate the restaurant node; details (hours/phone/cuisine) stay empty
 *    until an API key is set.
 *  - **With GOOGLE_PLACES_API_KEY:** upgrade to Place Details for full metadata.
 *
 * Area bulk import isn't supported here — use OSM for that.
 */
import type { Place, PlacesProvider } from "../types";
import { enrichFromOsm } from "./osmEnrich";
import { serpapiEnabled, resolveViaSerpApi } from "./serpapi";

const UA = "Trusty-Places/0.1 (link resolver)";
const API_KEY = process.env.GOOGLE_PLACES_API_KEY?.trim();

const norm = (s: string | undefined): string | undefined =>
  s?.trim().toLowerCase().replace(/\s+/g, "_") || undefined;

/** Follow redirects (short links → canonical URL) and return the final URL. */
async function finalUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    return r.url || url;
  } catch {
    return url;
  }
}

interface Parsed {
  name?: string;
  lat?: number;
  lng?: number;
  externalId?: string;
  placeId?: string;
}

/** Best-effort parse of a canonical Google Maps place URL. */
function parseGoogleUrl(url: string): Parsed {
  const out: Parsed = {};
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) { out.lat = Number(at[1]); out.lng = Number(at[2]); }
  // data=...!3dLAT!4dLNG carries the marker coords (more precise than @center).
  const d3 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (d3) { out.lat = Number(d3[1]); out.lng = Number(d3[2]); }
  const place = url.match(/\/place\/([^/@]+)/);
  if (place) out.name = decodeURIComponent(place[1]).replace(/\+/g, " ").trim();
  // Stable ids when present: ftid 0x..:0x.. or place_id / cid.
  const ftid = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) out.externalId = ftid[1];
  const pid = url.match(/[?&]query_place_id=([^&]+)/) || url.match(/[?&]place_id=([^&]+)/);
  if (pid) { out.placeId = decodeURIComponent(pid[1]); out.externalId ||= out.placeId; }
  const qcoord = url.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qcoord && out.lat === undefined) { out.lat = Number(qcoord[1]); out.lng = Number(qcoord[2]); }
  return out;
}

async function fromApi(placeId: string): Promise<Place | null> {
  if (!API_KEY) return null;
  const fields = "name,geometry,formatted_address,formatted_phone_number,website,opening_hours,price_level,types";
  const u = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${API_KEY}`;
  const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
  const b = (await r.json()) as { result?: Record<string, unknown>; status?: string };
  const res = b.result;
  if (!res) return null;
  const loc = (res.geometry as { location?: { lat: number; lng: number } })?.location;
  const priceLevel = typeof res.price_level === "number" ? "$".repeat(Math.max(1, Math.min(4, res.price_level))) : undefined;
  const hours = (res.opening_hours as { weekday_text?: string[] })?.weekday_text?.join("; ");
  return {
    externalId: placeId,
    source: "google",
    name: String(res.name ?? "").trim() || "Unnamed place",
    kind: "restaurant",
    cuisine: [],
    dietary: [],
    amenities: [],
    mealTypes: [],
    priceRange: priceLevel,
    hours,
    address: typeof res.formatted_address === "string" ? res.formatted_address : undefined,
    phone: typeof res.formatted_phone_number === "string" ? res.formatted_phone_number : undefined,
    website: typeof res.website === "string" ? res.website : undefined,
    geo: undefined,
    lat: loc?.lat ?? 0,
    lng: loc?.lng ?? 0,
  };
}

export const googleProvider: PlacesProvider = {
  name: "google",
  async fetchPlaces(): Promise<Place[]> {
    throw new Error("google provider is link-only — use PLACES_PROVIDER=osm for area bulk import");
  },
  async resolveLink(url: string): Promise<Place | null> {
    // Full URLs already carry name+coords — parse directly. Only expand short
    // links (goo.gl) via a redirect, which a full URL must not follow (it can
    // redirect to a consent page that strips the data).
    let p = parseGoogleUrl(url);
    if (p.name === undefined && p.lat === undefined) {
      p = parseGoogleUrl(await finalUrl(url));
    }
    if (!p.name && p.lat === undefined) return null; // couldn't extract anything useful
    const externalId = p.externalId ?? (p.lat !== undefined ? `ll_${p.lat}_${p.lng}` : norm(p.name)!);

    // 1) SerpApi — the rich Google import (categories, service options, hours, photos).
    if (serpapiEnabled()) {
      const viaSerp = await resolveViaSerpApi({ dataId: p.externalId, externalId, name: p.name ?? "", lat: p.lat, lng: p.lng }).catch(() => null);
      if (viaSerp) return viaSerp;
    }
    // 2) Official Google Places API (if a key is set).
    if (API_KEY && p.placeId) {
      const viaApi = await fromApi(p.placeId).catch(() => null);
      if (viaApi) return viaApi;
    }
    // 3) Keyless OSM enrichment fallback.
    // Keyless enrichment: fill details from OSM (Google URLs carry only name+coords).
    const e = p.name ? await enrichFromOsm({ name: p.name, lat: p.lat, lng: p.lng }).catch(() => null) : null;
    return {
      externalId,
      source: "google",
      name: p.name ?? "Unnamed place",
      kind: "restaurant",
      cuisine: e?.cuisine ?? [],
      dietary: e?.dietary ?? [],
      amenities: e?.amenities ?? [],
      mealTypes: e?.mealTypes ?? [],
      capacity: e?.capacity,
      outdoorSeating: e?.outdoorSeating,
      reservations: e?.reservations,
      hours: e?.hours,
      address: e?.address,
      phone: e?.phone,
      website: e?.website,
      photos: e?.photos,
      geo: e?.geo,
      lat: p.lat ?? e?.lat ?? 0,
      lng: p.lng ?? e?.lng ?? 0,
    };
  },
};
