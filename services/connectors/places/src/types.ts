/**
 * Normalized place shape every provider (OSM now; Google/Yandex/Foursquare later)
 * emits, plus the provider interface. Kept provider-agnostic so the main loop and
 * the ontology mapping never change when a new source is added.
 */
export interface Place {
  /** Provider-local id (e.g. OSM "node/123"). */
  externalId: string;
  /** Provider name: "osm" | "google" | "yandex" | "foursquare". */
  source: string;
  name: string;
  kind: "restaurant" | "cafe";
  cuisine: string[]; // mapped to the ontology restaurant `cuisine` options
  priceRange?: string; // "$".."$$$$"
  dietary: string[]; // vegetarian | vegan | halal | kosher | gluten_free
  amenities: string[]; // ontology `amenities` options (wifi, parking, takeaway, …)
  mealTypes: string[]; // ontology `meal_types` options (breakfast, dinner, …)
  goodFor?: string[]; // ontology `good_for` (groups, solo, business, date_night, …)
  capacity?: number; // seats (OSM `capacity`)
  outdoorSeating?: boolean;
  reservations?: boolean;
  hours?: string;
  address?: string;
  phone?: string;
  website?: string;
  /** Normalized city/area key (e.g. "yerevan"). */
  geo?: string;
  lat: number;
  lng: number;
  /** Photo URLs (OSM `image` tag, Wikimedia Commons, provider media). */
  photos?: string[];
}

export interface PlacesProvider {
  readonly name: string;
  /** Fetch places for an `area` (a "S,W,N,E" bbox or a city/area name). */
  fetchPlaces(area: string): Promise<Place[]>;
  /** Resolve a single share/place URL into one normalized Place (on-demand). */
  resolveLink?(url: string): Promise<Place | null>;
}
