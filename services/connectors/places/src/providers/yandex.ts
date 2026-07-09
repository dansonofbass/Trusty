/**
 * Yandex Maps provider — resolves a single org/share URL into a Place.
 *
 * Keyless (default): follow the share redirect to the canonical org URL and parse
 * the org id + name + coordinates. With YANDEX_MAPS_API_KEY (Yandex Search/Places
 * API), upgrade to full business details.
 *
 * Yandex matters for Caucasus/CIS coverage (better than OSM/Google there).
 */
import type { Place, PlacesProvider } from "../types";
import { enrichFromOsm } from "./osmEnrich";

const UA = "Trusty-Places/0.1 (link resolver)";
const API_KEY = process.env.YANDEX_MAPS_API_KEY?.trim();

async function finalUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    return r.url || url;
  } catch {
    return url;
  }
}

interface Parsed { name?: string; lat?: number; lng?: number; orgId?: string }

/** Yandex `ll` is lng,lat. Org URLs are /maps/org/<slug>/<orgId>/. */
function parseYandexUrl(url: string): Parsed {
  const out: Parsed = {};
  const org = url.match(/\/maps(?:\/[a-z]{2})?\/org\/([^/]+)\/(\d+)/i) || url.match(/\/org\/(\d+)/);
  if (org) {
    if (org.length === 3) {
      out.orgId = org[2];
      out.name = decodeURIComponent(org[1]).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    } else {
      out.orgId = org[1];
    }
  }
  const ll = url.match(/[?&]ll=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (ll) { out.lng = Number(ll[1]); out.lat = Number(ll[2]); } // ll = lng,lat
  const text = url.match(/[?&]text=([^&]+)/);
  if (text && !out.name) out.name = decodeURIComponent(text[1]).replace(/\+/g, " ").trim();
  return out;
}

async function fromApi(query: string): Promise<Place | null> {
  if (!API_KEY) return null;
  const u = `https://search-maps.yandex.ru/v1/?apikey=${API_KEY}&text=${encodeURIComponent(query)}&type=biz&lang=en_US&results=1`;
  const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
  const b = (await r.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }> };
  const f = b.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry?.coordinates ?? [0, 0];
  const meta = (f.properties?.CompanyMetaData as Record<string, unknown>) ?? {};
  return {
    externalId: String(meta.id ?? query),
    source: "yandex",
    name: String(meta.name ?? f.properties?.name ?? "Unnamed place"),
    kind: "restaurant",
    cuisine: [],
    dietary: [],
    amenities: [],
    mealTypes: [],
    hours: typeof meta.Hours === "object" && meta.Hours ? String((meta.Hours as { text?: string }).text ?? "") || undefined : undefined,
    address: typeof meta.address === "string" ? meta.address : undefined,
    phone: Array.isArray(meta.Phones) ? String((meta.Phones[0] as { formatted?: string })?.formatted ?? "") || undefined : undefined,
    website: typeof meta.url === "string" ? meta.url : undefined,
    lat,
    lng,
  };
}

export const yandexProvider: PlacesProvider = {
  name: "yandex",
  async fetchPlaces(): Promise<Place[]> {
    throw new Error("yandex provider is link-only — use PLACES_PROVIDER=osm for area bulk import");
  },
  async resolveLink(url: string): Promise<Place | null> {
    // Parse the pasted URL directly; only expand short share links (/maps/-/…)
    // via a redirect (a full org URL must not be redirect-followed).
    let p = parseYandexUrl(url);
    if (p.name === undefined && p.lat === undefined && p.orgId === undefined) {
      p = parseYandexUrl(await finalUrl(url));
    }
    if (API_KEY && (p.orgId || p.name)) {
      const viaApi = await fromApi(p.orgId ?? p.name!).catch(() => null);
      if (viaApi) return viaApi;
    }
    if (!p.name && p.lat === undefined) return null;
    const externalId = p.orgId ?? (p.lat !== undefined ? `ll_${p.lat}_${p.lng}` : p.name!.toLowerCase().replace(/\s+/g, "_"));
    // Keyless enrichment: Yandex blocks scraping + org URLs lack coords, so fill
    // details from OSM by name (disambiguated by coords when the URL had them).
    const e = p.name ? await enrichFromOsm({ name: p.name, lat: p.lat, lng: p.lng }).catch(() => null) : null;
    return {
      externalId,
      source: "yandex",
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
