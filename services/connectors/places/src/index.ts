/**
 * connector-places — publishes a restaurant/cafe catalog onto NATS.
 *
 * Fetches places from the configured provider (OSM/Overpass by default) for an
 * area, maps each onto the restaurant/cafe ontology, and upserts them as GLOBAL
 * `location` nodes via `graph.node.upsert`. graph-service ingests them into the
 * shared catalog as the system actor — no per-user coupling. Ratings stay
 * trust-native (this only supplies the catalog).
 *
 * Env: PLACES_PROVIDER (osm|google|yandex|foursquare, default osm),
 *      PLACES_AREA ("S,W,N,E" bbox or a city/area name, default "Yerevan"),
 *      CONNECTOR_INTERVAL_MS (0 = one-shot; else re-import loop), NATS_URL.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { connect, JSONCodec } from "nats";
import {
  NATS_SUBJECTS,
  type NodeUpsertEvent,
  type PlaceLinkSubmittedEvent,
  type PlaceLinkResolvedEvent,
} from "@constellation/graph-core";
import { getProvider, detectSource } from "./providers";
import type { Place } from "./types";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    resolve(here, "../../../../.env"),
  );
} catch {
  /* no repo-root .env */
}

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const PROVIDER = process.env.PLACES_PROVIDER ?? "osm";
const AREA = process.env.PLACES_AREA ?? "Yerevan";
const INTERVAL_MS = Number(process.env.CONNECTOR_INTERVAL_MS ?? 0); // 0 = one-shot

const KIND_LABEL: Record<Place["kind"], string> = { restaurant: "Restaurant", cafe: "Cafe" };

/** Stable, idempotent node id — re-imports upsert instead of duplicating. */
const nodeId = (p: Place): string => `place_${p.source}_${p.externalId.replace(/[^a-zA-Z0-9]+/g, "_")}`;

function subFor(p: Place): string {
  const bits = [KIND_LABEL[p.kind]];
  const flavor = p.kind === "restaurant" ? p.cuisine.slice(0, 2).join("/") : undefined;
  if (flavor) bits.push(flavor);
  if (p.geo) bits.push(p.geo);
  return bits.join(" · ");
}

/** Map a normalized Place onto the connector node-upsert event (ontology entity). */
function toEvent(p: Place): NodeUpsertEvent {
  const properties: Record<string, unknown> = { geo: p.geo };
  if (p.kind === "restaurant" && p.cuisine.length) properties.cuisine = p.cuisine;
  if (p.priceRange) properties.price_range = p.priceRange;
  if (p.dietary.length) properties.dietary = p.dietary;
  if (p.amenities.length) properties.amenities = p.amenities;
  if (p.mealTypes.length) properties.meal_types = p.mealTypes;
  if (p.goodFor?.length) properties.good_for = p.goodFor;
  if (p.capacity) properties.capacity = p.capacity;
  if (p.outdoorSeating !== undefined) properties.outdoor_seating = p.outdoorSeating;
  if (p.reservations !== undefined) properties.reservations = p.reservations;
  if (p.hours) properties.hours = p.hours;
  if (p.address) properties.address = p.address;
  if (p.phone) properties.phone = p.phone;
  if (p.website) properties.website = p.website;
  return {
    id: nodeId(p),
    type: "location",
    label: p.name,
    sub: subFor(p),
    clusters: ["food"],
    entityType: p.kind,
    properties,
    lat: p.lat,
    lng: p.lng,
    source: p.source,
    externalId: p.externalId,
    photos: p.photos,
  };
}

async function importOnce(nc: Awaited<ReturnType<typeof connect>>): Promise<void> {
  const provider = getProvider(PROVIDER);
  console.log(`connector-places: fetching from ${provider.name} for area "${AREA}"…`);
  const places = await provider.fetchPlaces(AREA);
  const jc = JSONCodec();
  for (const p of places) nc.publish(NATS_SUBJECTS.NODE_UPSERT, jc.encode(toEvent(p)));
  console.log(`connector-places: published ${places.length} places (${provider.name}) to NATS`);
}

/** Subscribe to on-demand link jobs: resolve a Google/Yandex URL → upsert a place. */
async function subscribeLinks(nc: Awaited<ReturnType<typeof connect>>): Promise<void> {
  const jc = JSONCodec();
  const sub = nc.subscribe(NATS_SUBJECTS.PLACE_LINK_SUBMITTED);
  console.log(`connector-places: listening for links on ${NATS_SUBJECTS.PLACE_LINK_SUBMITTED}`);
  (async () => {
    for await (const msg of sub) {
      const ev = jc.decode(msg.data) as PlaceLinkSubmittedEvent;
      const done = (r: PlaceLinkResolvedEvent) => nc.publish(NATS_SUBJECTS.PLACE_LINK_RESOLVED, jc.encode(r));
      try {
        const source = ev.source || detectSource(ev.url);
        const provider = source ? getProvider(source) : null;
        if (!provider?.resolveLink) throw new Error(`unsupported link (source=${source ?? "unknown"})`);
        const place = await provider.resolveLink(ev.url);
        if (!place) throw new Error("could not resolve place from link");
        const event = toEvent(place);
        nc.publish(NATS_SUBJECTS.NODE_UPSERT, jc.encode(event));
        console.log(`connector-places: resolved ${source} link → ${event.id} (${event.label})`);
        done({ linkId: ev.linkId, ok: true, nodeId: event.id, label: event.label });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`connector-places: link resolve failed (${ev.url}):`, error);
        done({ linkId: ev.linkId, ok: false, error });
      }
    }
  })().catch((e) => console.error("connector-places: link subscription ended:", e));
}

async function main() {
  const nc = await connect({ servers: NATS_URL });
  console.log(`connector-places connected to ${NATS_URL} (provider=${PROVIDER})`);
  // Always listen for on-demand link submissions (admin / user "add by link").
  await subscribeLinks(nc);
  if (INTERVAL_MS > 0) {
    await importOnce(nc).catch((e) => console.error("connector-places import failed:", e));
    setInterval(() => importOnce(nc).catch((e) => console.error("connector-places import failed:", e)), INTERVAL_MS);
  } else if (process.env.PLACES_AREA_ONESHOT === "true") {
    await importOnce(nc);
    await nc.drain();
    console.log("connector-places: done (one-shot area import).");
  } else {
    console.log("connector-places: link-only mode (no area import). Stays alive for link jobs.");
  }
}

main().catch((e) => {
  console.error("connector-places failed:", e);
  process.exit(1);
});
