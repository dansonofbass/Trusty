/**
 * External knowledge sources we can attach to extracted entities.
 * Start with Wikipedia; more providers (Wikidata, OpenLibrary…) plug in here.
 */
import type { ThoughtExtraction } from "./types";

export type EntitySourceProvider = "wikipedia";

export interface EntitySource {
  provider: EntitySourceProvider;
  /** Canonical page URL (e.g. https://en.wikipedia.org/wiki/Deep_work). */
  url: string;
  /** Resolved title on the source site. */
  title: string;
  /** Wikipedia language code — en, fa, … */
  lang?: string;
  imageUrl?: string;
}

/** Which providers are enabled (comma-separated env: ENTITY_SOURCES=wikipedia). */
export function parseEnabledSourceProviders(raw?: string): EntitySourceProvider[] {
  const v = (raw ?? "wikipedia").trim();
  if (!v || v === "none" || v === "off") return [];
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EntitySourceProvider => s === "wikipedia");
}

const PERSIAN = /[\u0600-\u06FF]/;

/** Pick Wikipedia language from the entity name (Persian script → fa, else en). */
export function wikipediaLangForName(name: string): "en" | "fa" {
  return PERSIAN.test(name) ? "fa" : "en";
}

const UA = "Trusty/0.1 (graph extraction; +https://github.com/)";

/**
 * Search Wikipedia for an entity name using the opensearch API.
 * Returns null when nothing plausible is found.
 */
export async function resolveWikipediaSource(
  name: string,
  lang?: "en" | "fa",
): Promise<EntitySource | null> {
  const wikiLang = lang ?? wikipediaLangForName(name);
  const api = `https://${wikiLang}.wikipedia.org/w/api.php?${new URLSearchParams({
    action: "opensearch",
    search: name.trim().slice(0, 120),
    limit: "1",
    namespace: "0",
    format: "json",
    origin: "*",
  })}`;

  try {
    const r = await fetch(api, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as [string, string[], string[], string[]];
    const title = data[1]?.[0];
    const url = data[3]?.[0];
    if (!title || !url) return null;
    const imageUrl = await fetchWikipediaThumbnail(title, wikiLang);
    return { provider: "wikipedia", url, title, lang: wikiLang, imageUrl: imageUrl ?? undefined };
  } catch {
    return null;
  }
}

/** Lead image from the Wikipedia REST summary API. */
async function fetchWikipediaThumbnail(
  title: string,
  lang: "en" | "fa",
): Promise<string | null> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const api = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`;
  try {
    const r = await fetch(api, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { thumbnail?: { source?: string } };
    return data.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

/** Run async tasks with a concurrency cap (avoid hammering Wikipedia). */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/**
 * After LLM extraction, look up each entity in configured external sources and
 * attach matches on the entity (`sources[]`). Only the top entities by salience
 * are resolved to keep latency reasonable.
 */
export async function enrichExtractionWithSources(
  extraction: ThoughtExtraction,
  opts: {
    providers?: EntitySourceProvider[];
    maxLookups?: number;
    concurrency?: number;
  } = {},
): Promise<ThoughtExtraction> {
  const providers = opts.providers ?? parseEnabledSourceProviders(process.env.ENTITY_SOURCES);
  if (!providers.includes("wikipedia") || extraction.entities.length === 0) {
    return extraction;
  }

  const maxLookups = opts.maxLookups ?? 10;
  const concurrency = opts.concurrency ?? 3;

  const ranked = [...extraction.entities]
    .sort((a, b) => (b.salience ?? 0.5) - (a.salience ?? 0.5))
    .slice(0, maxLookups);

  const resolved = await mapPool(ranked, concurrency, async (entity) => {
    const source = await resolveWikipediaSource(entity.name);
    return { name: entity.name, source };
  });

  const byName = new Map(resolved.filter((r) => r.source).map((r) => [r.name, r.source!]));

  const entities = extraction.entities.map((e) => {
    const source = byName.get(e.name);
    if (!source) return e;
    return { ...e, sources: [source] };
  });

  return { ...extraction, entities };
}
