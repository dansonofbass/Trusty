/**
 * Taste import client — turn a user's own places into their trust edges.
 * `parseImportText` is lenient: a plain array, a GeoJSON FeatureCollection
 * (Google Takeout "Saved places"), or Google "Reviews" JSON all normalize to
 * the same `{name, geo?, rating?}` shape the import endpoint expects.
 */
export interface ImportPlace {
  name: string;
  geo?: string;
  rating?: number;
  source?: string;
  externalId?: string;
}

export async function importPlaces(
  places: ImportPlace[],
): Promise<{ ok: boolean; imported: number; created: number }> {
  const r = await fetch("/api/import/places", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ places }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `import failed (${r.status})`);
  return b as { ok: boolean; imported: number; created: number };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Parse pasted/uploaded text into normalized import places. Throws on bad JSON. */
export function parseImportText(text: string): ImportPlace[] {
  const data = JSON.parse(text) as unknown;
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { features?: unknown[] })?.features)
      ? (data as { features: unknown[] }).features
      : [];
  const out: ImportPlace[] = [];
  for (const it of rows) {
    const o = (it ?? {}) as Record<string, unknown>;
    // Plain shape
    if (str(o.name)) {
      out.push({ name: str(o.name)!, geo: str(o.geo) ?? str(o.city), rating: num(o.rating) });
      continue;
    }
    // Google Takeout GeoJSON / Reviews: data lives under `properties`.
    const p = (o.properties ?? {}) as Record<string, unknown>;
    const loc = (p.Location ?? p.location ?? {}) as Record<string, unknown>;
    const name = str(p.Title) ?? str(loc["Business Name"]) ?? str(loc.name) ?? str(p.name);
    if (!name) continue;
    const addr = str(loc.Address) ?? str(loc.address) ?? str(p.address);
    const geo = addr ? addr.split(",").map((s) => s.trim()).filter(Boolean).slice(-2, -1)[0] : str(p.city);
    const rating = num(p.starRating) ?? num(p.rating) ?? num(p["five_star_rating_published"]);
    out.push({ name, geo, rating });
  }
  return out;
}
