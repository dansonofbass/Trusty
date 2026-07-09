/**
 * Provider registry. OSM is implemented; Google/Yandex/Foursquare are stubs
 * behind the same interface — each needs an API key wired via env (see
 * docker-compose ${VAR:-} passthrough) before it can be implemented. Adding a
 * provider never touches the main loop or the ontology mapping.
 */
import type { PlacesProvider } from "../types";
import { osmProvider } from "./osm";
import { googleProvider } from "./google";
import { yandexProvider } from "./yandex";

const stub = (name: string, keyEnv: string): PlacesProvider => ({
  name,
  async fetchPlaces() {
    throw new Error(
      `places provider "${name}" not implemented yet — set PLACES_PROVIDER=osm, or implement providers/${name}.ts using ${keyEnv}`,
    );
  },
});

const PROVIDERS: Record<string, PlacesProvider> = {
  osm: osmProvider,
  google: googleProvider,
  yandex: yandexProvider,
  foursquare: stub("foursquare", "FOURSQUARE_API_KEY"),
};

export function getProvider(name: string): PlacesProvider {
  return PROVIDERS[name] ?? osmProvider;
}

/** Which provider a maps URL belongs to (for link resolution). */
export function detectSource(url: string): "google" | "yandex" | null {
  const u = url.toLowerCase();
  if (/(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)/.test(u) || u.includes("google.com/maps")) return "google";
  if (/(^|\.)yandex\.[a-z.]+/.test(u) || u.includes("yandex.")) return "yandex";
  return null;
}
