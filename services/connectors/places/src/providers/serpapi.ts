/**
 * SerpApi Google Maps resolver — the rich Google import path.
 *
 * One search per link resolves a place's FULL detail (categories, service
 * options, accessibility, offerings, payments, hours, price, coords, thumbnail),
 * which we map onto the ontology. Each SerpApi key is limited (≈250/mo), so
 * `SERPAPI_KEYS` holds several comma-separated keys and we round-robin + fail
 * over to the next key when one is exhausted. Deliberately does NOT import
 * Google's star rating / review count — trust stays the moat.
 *
 * Docs: https://serpapi.com/google-maps-api
 */
import type { Place } from "../types";

const KEYS = (process.env.SERPAPI_KEYS ?? process.env.SERPAPI_KEY ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
let keyIdx = 0;

export const serpapiEnabled = (): boolean => KEYS.length > 0;

/** Round-robin across keys; retry the next key on quota/auth errors. */
async function serp(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  if (!KEYS.length) return null;
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const key = KEYS[keyIdx % KEYS.length];
    keyIdx++;
    const qs = new URLSearchParams({ ...params, api_key: key, hl: "en" });
    try {
      const r = await fetch(`https://serpapi.com/search.json?${qs.toString()}`, { signal: AbortSignal.timeout(20000) });
      const j = (await r.json()) as Record<string, unknown>;
      const err = typeof j.error === "string" ? j.error : "";
      if (err) {
        console.warn(`serpapi: key #${(keyIdx - 1) % KEYS.length} error: ${err}`);
        if (/run out|limit|quota|plan|invalid api key|unauthor/i.test(err)) continue; // exhausted → next key
        return null; // e.g. "no results" — a real miss, don't burn more keys
      }
      return j;
    } catch (e) {
      console.warn("serpapi: request failed:", e instanceof Error ? e.message : e);
      continue; // network hiccup → try next key
    }
  }
  return null;
}

/* ----------------------- feature mapping --------------------------- */

const has = (s: string, re: RegExp) => re.test(s);

/** Google category strings ("Armenian restaurant") → ontology cuisine options. */
const CUISINE_RE: Array<[RegExp, string]> = [
  [/armenian/i, "armenian"], [/georgian/i, "georgian"], [/persian|iranian/i, "persian"],
  [/russian/i, "russian"], [/caucas/i, "caucasian"], [/lebanese/i, "lebanese"], [/turkish/i, "turkish"],
  [/greek/i, "greek"], [/mediterran/i, "mediterranean"], [/middle.?eastern/i, "middle_eastern"],
  [/eastern european/i, "eastern_european"], [/european/i, "european"], [/international/i, "international"],
  [/ital/i, "italian"], [/pizz/i, "pizza"], [/french/i, "french"], [/japan|sushi/i, "japanese"],
  [/chinese/i, "chinese"], [/thai/i, "thai"], [/indian/i, "indian"], [/mexican/i, "mexican"],
  [/american|burger/i, "american"], [/barbe|bbq|grill/i, "barbecue"], [/seafood|fish/i, "seafood"],
  [/steak/i, "steakhouse"], [/fast food/i, "fast_food"], [/asian/i, "asian"], [/veg(etari)?an/i, "vegetarian"],
];
function cuisineFrom(strings: string[]): string[] {
  const out = new Set<string>();
  for (const s of strings) for (const [re, opt] of CUISINE_RE) if (re.test(s)) out.add(opt);
  return [...out];
}

/** Flatten SerpApi `extensions` (array of {category:[values]}) into one list. */
function extValues(place: Record<string, unknown>): string[] {
  const ext = place.extensions;
  const out: string[] = [];
  if (Array.isArray(ext)) {
    for (const group of ext) {
      if (group && typeof group === "object") {
        for (const v of Object.values(group as Record<string, unknown>)) {
          if (Array.isArray(v)) out.push(...v.map(String));
        }
      }
    }
  }
  return out;
}

function mapFeatures(place: Record<string, unknown>): {
  amenities: string[]; mealTypes: string[]; dietary: string[]; goodFor: string[];
  outdoorSeating?: boolean; reservations?: boolean;
} {
  const vals = extValues(place);
  const so = (place.service_options ?? {}) as Record<string, unknown>;
  const blob = vals.join(" | ").toLowerCase();

  const amenities = new Set<string>();
  const add = (cond: boolean, a: string) => cond && amenities.add(a);
  add(/wi-?fi/.test(blob), "wifi");
  add(/free wi-?fi/.test(blob), "free_wifi");
  add(/outdoor seating|rooftop|patio|sidewalk seating|terrace/.test(blob), "outdoor_seating");
  add(/bar onsite|full bar/.test(blob), "full_bar");
  add(/alcohol|beer|wine|cocktail|spirits|happy hour/.test(blob), "serves_alcohol");
  add(/beer|wine/.test(blob), "wine_beer");
  add(/live music|live performance/.test(blob), "live_music");
  add(/wheelchair/.test(blob), "wheelchair_accessible");
  add(/credit card|debit card/.test(blob), "accepts_cards");
  add(/nfc|mobile payment|apple pay|google pay|contactless/.test(blob), "digital_payments");
  add(/delivery/.test(blob) && !/no delivery/.test(blob) || so.delivery === true, "delivery");
  add(/takeout|takeaway|counter service/.test(blob) || so.takeout === true, "takeaway");
  add(/drive.?through/.test(blob), "drive_through");
  add(/reservation/.test(blob), "reservations");
  add(/dogs allowed|dog.friendly/.test(blob), "dog_friendly");
  add(/high chair/.test(blob), "highchairs");
  add(/good for kids|kids' menu|family.friendly|family style/.test(blob), "family_style");
  add(/street parking/.test(blob), "street_parking");
  add(/parking/.test(blob), "parking");
  add(/private (dining|room|events)/.test(blob), "private_dining");
  add(/air.?condition/.test(blob), "air_conditioning");
  add(/\btv\b|television|sports on/.test(blob), "tv");
  add(/indoor seating/.test(blob), "indoor_seating");
  add(/table service/.test(blob) || so.dine_in === true, "table_service");
  add(/non.?smoking/.test(blob), "non_smoking");

  const mealTypes = new Set<string>();
  const meal = (re: RegExp, m: string) => has(blob, re) && mealTypes.add(m);
  meal(/breakfast/, "breakfast"); meal(/brunch/, "brunch"); meal(/lunch/, "lunch");
  meal(/dinner/, "dinner"); meal(/dessert/, "dessert"); meal(/late.?night/, "late_night");
  meal(/coffee/, "coffee"); meal(/\bdrinks\b|cocktail|happy hour/, "drinks");

  const dietary = new Set<string>();
  if (/vegetarian/.test(blob)) dietary.add("vegetarian");
  if (/vegan/.test(blob)) dietary.add("vegan");
  if (/halal/.test(blob)) dietary.add("halal");
  if (/kosher/.test(blob)) dietary.add("kosher");
  if (/gluten/.test(blob)) dietary.add("gluten_free");

  const goodFor = new Set<string>();
  if (/groups/.test(blob)) goodFor.add("groups");
  if (/solo dining|solo/.test(blob)) goodFor.add("solo");
  if (/business/.test(blob)) goodFor.add("business");
  if (/family.friendly|good for kids/.test(blob)) goodFor.add("family");
  if (/romantic|date/.test(blob)) goodFor.add("date_night");
  if (/quick bite|fast service/.test(blob)) goodFor.add("quick_bite");

  return {
    amenities: [...amenities], mealTypes: [...mealTypes], dietary: [...dietary], goodFor: [...goodFor],
    outdoorSeating: amenities.has("outdoor_seating") ? true : undefined,
    reservations: /accepts reservation|reservations recommended|reservations required/.test(blob) ? true : undefined,
  };
}

const DAYS: Array<[RegExp, string]> = [
  [/^mon/i, "Mo"], [/^tue/i, "Tu"], [/^wed/i, "We"], [/^thu/i, "Th"], [/^fri/i, "Fr"], [/^sat/i, "Sa"], [/^sun/i, "Su"],
];

/** "10 AM" / "12:30 PM" → minutes-from-midnight; null if unparseable. Meridiem
 *  may be inherited (e.g. the "1" in "1–11:30 PM"). */
function toMin(s: string, inheritMer?: string): number | null {
  let str = s.trim();
  if (!/(am|pm)/i.test(str) && inheritMer) str = `${str} ${inheritMer}`;
  const m = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2] ?? "0");
}
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "1–11:30 PM" / "11 AM–2 PM" / "10 AM–12 AM" → "HH:MM-HH:MM" (24h). */
function parseRange(raw: string): string | null {
  const parts = raw.split(/[–—-]|(?:\s+to\s+)/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const closeMer = (parts[1].match(/(am|pm)/i) ?? [])[1];
  const oHadMer = /(am|pm)/i.test(parts[0]);
  let om = toMin(parts[0], closeMer);
  let cm = toMin(parts[1]);
  if (om === null || cm === null) return null;
  if (cm === 0) cm = 24 * 60; // midnight close → 24:00
  if (!oHadMer && om >= cm) om -= 12 * 60; // inherited PM but it was really AM ("11–2 PM")
  if (om < 0) return null;
  return `${fmt(om)}-${fmt(cm)}`;
}

/** Google per-day hours → OSM `opening_hours` string (for our weeklyHours parser). */
function hoursFrom(place: Record<string, unknown>): string | undefined {
  // Normalize to { day: "10 AM–12 AM" }
  const perDay: Record<string, string> = {};
  const src = place.hours ?? place.operating_hours;
  if (Array.isArray(src)) {
    for (const row of src) {
      if (row && typeof row === "object") {
        for (const [d, v] of Object.entries(row as Record<string, unknown>)) perDay[d] = String(v);
      }
    }
  } else if (src && typeof src === "object") {
    for (const [d, v] of Object.entries(src as Record<string, unknown>)) perDay[d] = String(v);
  }
  const rules: string[] = [];
  for (const [re, code] of DAYS) {
    const entry = Object.entries(perDay).find(([d]) => re.test(d));
    if (!entry) continue;
    const raw = entry[1].trim();
    if (/closed/i.test(raw)) { rules.push(`${code} off`); continue; }
    if (/24 ?hours|open 24/i.test(raw)) { rules.push(`${code} 00:00-24:00`); continue; }
    // A day can have split shifts ("12–3 PM, 6–11 PM").
    const ranges = raw.split(",").map((r) => parseRange(r)).filter((r): r is string => !!r);
    if (ranges.length) rules.push(`${code} ${ranges.join(",")}`);
  }
  return rules.length ? rules.join("; ") : undefined;
}

function photosFrom(place: Record<string, unknown>): string[] | undefined {
  const out: string[] = [];
  const thumb = place.thumbnail;
  if (typeof thumb === "string" && /^https?:\/\//.test(thumb)) out.push(thumb);
  const imgs = place.images;
  if (Array.isArray(imgs)) {
    for (const im of imgs) {
      const u = typeof im === "string" ? im : (im as { image?: string; thumbnail?: string })?.image ?? (im as { thumbnail?: string })?.thumbnail;
      if (typeof u === "string" && /^https?:\/\//.test(u)) out.push(u);
    }
  }
  return out.length ? [...new Set(out)].slice(0, 10) : undefined;
}

/** Map a SerpApi place object (place_results or a local_results row) → Place. */
function toPlace(place: Record<string, unknown>, source: string, externalId: string, fallback: { name: string; lat?: number; lng?: number }): Place | null {
  const title = typeof place.title === "string" ? place.title : fallback.name;
  const gps = (place.gps_coordinates ?? {}) as { latitude?: number; longitude?: number };
  const lat = gps.latitude ?? fallback.lat ?? 0;
  const lng = gps.longitude ?? fallback.lng ?? 0;
  if (!title) return null;

  const types = ([] as string[]).concat(
    Array.isArray(place.types) ? (place.types as string[]) : [],
    typeof place.type === "string" ? [place.type] : Array.isArray(place.type) ? (place.type as string[]) : [],
    [title],
  );
  const f = mapFeatures(place);
  const price = typeof place.price === "string" && /^\$+$/.test(place.price.trim()) ? place.price.trim() : undefined;

  return {
    externalId,
    source,
    name: title,
    kind: /cafe|coffee/i.test(types.join(" ")) ? "cafe" : "restaurant",
    cuisine: cuisineFrom(types),
    dietary: f.dietary,
    amenities: f.amenities,
    mealTypes: f.mealTypes,
    goodFor: f.goodFor,
    priceRange: price,
    outdoorSeating: f.outdoorSeating,
    reservations: f.reservations,
    hours: hoursFrom(place),
    address: typeof place.address === "string" ? place.address : undefined,
    phone: typeof place.phone === "string" ? place.phone : undefined,
    website: typeof place.website === "string" ? place.website : undefined,
    photos: photosFrom(place),
    geo: undefined,
    lat,
    lng,
  };
}

const FTID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

/** Resolve a Google place via SerpApi. `dataId` (ftid 0x..:0x.. from the URL) is
 *  used for the exact lookup; else a name+coords search. `externalId` is the
 *  stable node id (kept consistent with the keyless path). One search/import. */
export async function resolveViaSerpApi(opts: {
  dataId?: string; externalId: string; name: string; lat?: number; lng?: number;
}): Promise<Place | null> {
  if (!KEYS.length) return null;
  let place: Record<string, unknown> | null = null;

  if (opts.dataId && FTID.test(opts.dataId)) {
    // SerpApi place lookup wants the CID (second half of the ftid) in decimal.
    let dataCid: string | null = null;
    try { dataCid = BigInt(opts.dataId.split(":")[1]).toString(); } catch { dataCid = null; }
    if (dataCid) {
      const j = await serp({ engine: "google_maps", type: "place", data_cid: dataCid });
      place = (j?.place_results as Record<string, unknown>) ?? null;
    }
  }
  if (!place && opts.name) {
    const ll = typeof opts.lat === "number" && typeof opts.lng === "number" ? `@${opts.lat},${opts.lng},15z` : undefined;
    const j = await serp({ engine: "google_maps", type: "search", q: opts.name, ...(ll ? { ll } : {}) });
    const local = Array.isArray(j?.local_results) ? (j!.local_results as Record<string, unknown>[])[0] : null;
    place = (j?.place_results as Record<string, unknown>) ?? local ?? null;
  }
  if (!place) return null;
  const mapped = toPlace(place, "google", opts.externalId, opts);
  if (mapped) {
    console.log(
      `serpapi: resolved "${mapped.name}" — cuisine ${mapped.cuisine.length}, amenities ${mapped.amenities.length}, ` +
        `meals ${mapped.mealTypes.length}, photos ${mapped.photos?.length ?? 0}${mapped.hours ? ", hours ✓" : ""}`,
    );
  }
  return mapped;
}
