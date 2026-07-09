/**
 * OpenStreetMap provider — restaurants & cafes via the Overpass API.
 *
 * Free, no API key, ODbL-licensed (persistable as our catalog). One Overpass
 * query per run (be a good citizen: bounded area + result cap + timeout + a
 * descriptive User-Agent). Tags map directly onto the restaurant/cafe ontology.
 */
import type { Place, PlacesProvider } from "../types";

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const UA = "Trusty-Places/0.1 (trust-graph restaurant catalog)";
const MAX_RESULTS = Number(process.env.PLACES_MAX ?? 400);

/** OSM `cuisine` tag → normalized values. Unknowns are dropped later by the
 *  ontology's `validateEntityProperties` (single source of truth for options), so
 *  here we only split, normalize, and alias common synonyms. */
const CUISINE_ALIAS: Record<string, string> = {
  steak_house: "steakhouse", steak: "steakhouse", pasta: "italian", iranian: "persian",
  fish: "seafood", coffee_shop: "coffee", bbq: "barbecue", grill: "barbecue",
};
const mapCuisine = (raw: string): string[] =>
  Array.from(
    new Set(
      raw
        .split(";")
        .map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean)
        .map((c) => CUISINE_ALIAS[c] ?? c),
    ),
  );

const norm = (s: string | undefined): string | undefined =>
  s?.trim().toLowerCase().replace(/\s+/g, "_") || undefined;

const yes = (v: string | undefined): boolean => v === "yes" || v === "only" || v === "wlan";

/** Map OSM feature tags onto the ontology `amenities` options. */
function amenitiesFromTags(t: Record<string, string>): string[] {
  const a = new Set<string>();
  if (t.wheelchair === "yes" || t.wheelchair === "limited") a.add("wheelchair_accessible");
  if (yes(t.internet_access)) a.add("wifi");
  if (yes(t.internet_access) && t["internet_access:fee"] === "no") a.add("free_wifi");
  if (t.outdoor_seating === "yes") a.add("outdoor_seating");
  if (yes(t.takeaway)) a.add("takeaway");
  if (yes(t.delivery)) a.add("delivery");
  if (yes(t.drive_through)) a.add("drive_through");
  if (t.bar === "yes" || t.amenity === "bar") a.add("full_bar");
  if (t.air_conditioning === "yes") a.add("air_conditioning");
  if (t.outdoor_seating === "yes") a.add("outdoor_seating");
  if (t.indoor_seating === "yes") a.add("indoor_seating");
  if (t.smoking === "no" || t.smoking === "outside" || t.smoking === "separated") a.add("non_smoking");
  if (t.dog === "yes" || t.dog === "leashed") a.add("dog_friendly");
  if (t.parking === "yes" || t["parking:street"] || t.amenity === "parking") a.add("parking");
  const payKeys = Object.keys(t).filter((k) => k.startsWith("payment:"));
  if (payKeys.some((k) => t[k] === "yes" && /card|visa|mastercard|maestro|amex|credit|debit/.test(k))) a.add("accepts_cards");
  if (payKeys.some((k) => t[k] === "yes" && /(google|apple|contactless|qr|nfc)/.test(k))) a.add("digital_payments");
  if (t.reservation && ["yes", "required", "recommended"].includes(t.reservation)) a.add("reservations");
  return [...a];
}

/** Infer ontology `meal_types` from cuisine hints / meal tags. */
function mealTypesFromTags(t: Record<string, string>): string[] {
  const m = new Set<string>();
  const c = (t.cuisine ?? "").toLowerCase();
  if (t.breakfast === "yes" || /breakfast/.test(c)) m.add("breakfast");
  if (/coffee_shop|coffee|cafe/.test(c) || t.amenity === "cafe") m.add("coffee");
  if (/dessert|ice_cream|bakery|cake/.test(c)) m.add("dessert");
  if (t.bar === "yes" || t.amenity === "bar" || t.amenity === "pub") m.add("drinks");
  return [...m];
}

/** OSM photo tags → image URLs. `image` is a direct URL; `wikimedia_commons`
 *  is a "File:Foo.jpg" ref resolvable via Commons' Special:FilePath redirect. */
function photosFromTags(t: Record<string, string>): string[] | undefined {
  const out: string[] = [];
  if (t.image && /^https?:\/\//i.test(t.image.trim())) out.push(t.image.trim());
  const commons = t.wikimedia_commons?.trim();
  if (commons && /^file:/i.test(commons)) {
    const file = commons.replace(/^file:/i, "").trim();
    out.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=800`);
  }
  return out.length ? out : undefined;
}

const isBbox = (area: string): boolean => /^\s*-?\d+(\.\d+)?(\s*,\s*-?\d+(\.\d+)?){3}\s*$/.test(area);

function buildQuery(area: string): string {
  const filter = '["amenity"~"^(restaurant|cafe)$"]["name"]';
  const body = isBbox(area)
    ? `node${filter}(${area});way${filter}(${area});`
    : `area["name"="${area.replace(/"/g, "")}"]->.a;(node${filter}(area.a);way${filter}(area.a););`;
  return `[out:json][timeout:60];${isBbox(area) ? `(${body});` : body}out center tags ${MAX_RESULTS};`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** All the ontology fields derivable from OSM tags (shared by the Overpass area
 *  import and the Nominatim link-enrichment path — same tag vocabulary). */
export function mapTags(t: Record<string, string>): Pick<
  Place,
  "cuisine" | "dietary" | "amenities" | "mealTypes" | "outdoorSeating" | "reservations" | "hours" | "address" | "phone" | "website" | "photos" | "capacity"
> & { geo?: string; kind?: Place["kind"] } {
  const dietary: string[] = [];
  if (t["diet:vegetarian"] === "yes") dietary.push("vegetarian");
  if (t["diet:vegan"] === "yes") dietary.push("vegan");
  if (t["diet:halal"] === "yes") dietary.push("halal");
  if (t["diet:kosher"] === "yes") dietary.push("kosher");
  if (t["diet:gluten_free"] === "yes") dietary.push("gluten_free");
  const address = [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(", ") || undefined;
  const cap = Number(t.capacity);
  return {
    kind: t.amenity === "cafe" ? "cafe" : "restaurant",
    cuisine: t.cuisine ? mapCuisine(t.cuisine) : [],
    dietary,
    amenities: amenitiesFromTags(t),
    mealTypes: mealTypesFromTags(t),
    outdoorSeating: t.outdoor_seating ? t.outdoor_seating === "yes" : undefined,
    reservations: t.reservation ? ["yes", "required", "recommended"].includes(t.reservation) : undefined,
    hours: t.opening_hours || undefined,
    address,
    phone: t.phone || t["contact:phone"] || undefined,
    website: t.website || t["contact:website"] || undefined,
    photos: photosFromTags(t),
    capacity: Number.isFinite(cap) && cap > 0 ? cap : undefined,
    geo: norm(t["addr:city"] || t["addr:suburb"]),
  };
}

function toPlace(el: OverpassElement, fallbackGeo?: string): Place | null {
  const t = el.tags ?? {};
  // Prefer a Latin/English name for readable catalog labels.
  const name = (t["name:en"] || t.name || t.int_name)?.trim();
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;

  const f = mapTags(t);
  return {
    externalId: `${el.type}/${el.id}`,
    source: "osm",
    name,
    kind: f.kind ?? "restaurant",
    cuisine: f.cuisine,
    dietary: f.dietary,
    amenities: f.amenities,
    mealTypes: f.mealTypes,
    capacity: f.capacity,
    outdoorSeating: f.outdoorSeating,
    reservations: f.reservations,
    hours: f.hours,
    address: f.address,
    phone: f.phone,
    website: f.website,
    geo: f.geo ?? fallbackGeo,
    lat,
    lng,
    photos: f.photos,
  };
}

export const osmProvider: PlacesProvider = {
  name: "osm",
  async fetchPlaces(area: string): Promise<Place[]> {
    const query = buildQuery(area);
    const fallbackGeo = isBbox(area) ? undefined : norm(area);
    const r = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`overpass ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const data = (await r.json()) as { elements?: OverpassElement[] };
    const places: Place[] = [];
    for (const el of data.elements ?? []) {
      const p = toPlace(el, fallbackGeo);
      if (p) places.push(p);
    }
    return places;
  },
};
