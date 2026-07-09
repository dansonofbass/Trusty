/**
 * Ingestion event contract — every connector publishes onto NATS using these
 * subjects and payloads. graph-service subscribes and upserts into the graph.
 */
import { refreshDerived } from "./recommend";
import { validateEntityProperties } from "./ontology";
import {
  Dataset,
  EdgeType,
  GLink,
  GNode,
  NodeType,
  TasteCluster,
} from "./types";

export const NATS_SUBJECTS = {
  NODE_UPSERT: "graph.node.upsert",
  EDGE_UPSERT: "graph.edge.upsert",
  /** A place URL (Google/Yandex Maps) submitted for on-demand resolution. */
  PLACE_LINK_SUBMITTED: "places.link.submitted",
  /** The connector's result after resolving a submitted link. */
  PLACE_LINK_RESOLVED: "places.link.resolved",
} as const;

/** Payload for `places.link.submitted` — a maps link to resolve into a place. */
export interface PlaceLinkSubmittedEvent {
  /** Tracking id from the place_links row. */
  linkId: string;
  url: string;
  /** "google" | "yandex" (detected from the URL). */
  source: string;
}

/** Payload for `places.link.resolved` — the connector's outcome for a link. */
export interface PlaceLinkResolvedEvent {
  linkId: string;
  ok: boolean;
  /** The upserted place node id, when ok. */
  nodeId?: string;
  label?: string;
  error?: string;
}

/** Payload for `graph.node.upsert`. */
export interface NodeUpsertEvent {
  id: string;
  type: NodeType;
  label: string;
  sub?: string;
  clusters?: TasteCluster[];
  /** Ontology class for provider entities (e.g. "restaurant") — see ./ontology. */
  entityType?: string;
  /** Typed attributes for that entity type (cuisine, price_range, geo, …). */
  properties?: Record<string, unknown>;
  /** Geographic coordinates (places connectors). */
  lat?: number;
  lng?: number;
  /** Where the data came from — e.g. "youtube", "osm", "google". */
  source?: string;
  externalId?: string;
  /** Photo URLs (OSM `image` tag, Wikimedia, provider media). */
  photos?: string[];
}

/** Payload for `graph.edge.upsert`. */
export interface EdgeUpsertEvent {
  source: string;
  target: string;
  type: EdgeType;
  weight?: number;
  label?: string;
  observedAt?: string;
  provenance?: string;
}

const NODE_TYPES = new Set<NodeType>([
  "person",
  "book",
  "news",
  "music",
  "video",
  "social_account",
  "post",
  "movie",
  "financial_signal",
  "location",
  "thought",
  "concept",
  "menu_item",
]);

const EDGE_TYPES = new Set<EdgeType>([
  "FRIENDS_WITH",
  "READS",
  "LISTENS_TO",
  "WATCHES",
  "FOLLOWS",
  "LIKES",
  "POSTED",
  "TRACKS",
  "VISITED",
  "RECOMMENDED",
  "MENTIONS",
  "RELATES_TO",
  "REFLECTS_ON",
  "PART_OF",
]);

const CLUSTER_SET = new Set<TasteCluster>([
  "tech_ai",
  "cinema",
  "persian_culture",
  "finance",
  "indie_music",
  "travel",
  "food",
]);

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** Keep only well-formed http(s) photo URLs, capped — connector input is untrusted. */
function sanitizePhotos(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const urls = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => /^https?:\/\//i.test(x))
    .slice(0, 8);
  return urls.length ? Array.from(new Set(urls)) : undefined;
}

function validateNode(ev: NodeUpsertEvent): NodeUpsertEvent {
  if (!ev?.id || !ev.label?.trim()) throw new Error("node upsert needs id + label");
  if (!NODE_TYPES.has(ev.type)) throw new Error(`unknown node type: ${ev.type}`);
  return ev;
}

function validateEdge(ev: EdgeUpsertEvent): EdgeUpsertEvent {
  if (!ev?.source || !ev?.target) throw new Error("edge upsert needs source + target");
  if (!EDGE_TYPES.has(ev.type)) throw new Error(`unknown edge type: ${ev.type}`);
  return ev;
}

/** Merge or create a node from a connector event. Carries the full entity
 *  identity (entityType + validated properties + coordinates + provenance) so a
 *  places connector can create a real ontology entity (e.g. a restaurant). */
export function upsertNode(d: Dataset, raw: NodeUpsertEvent): Dataset {
  const ev = validateNode(raw);
  const clusters = (ev.clusters ?? []).filter((c) => CLUSTER_SET.has(c));
  const properties =
    ev.entityType && ev.properties ? validateEntityProperties(ev.entityType, ev.properties) : ev.properties;

  const merged = (prev?: GNode): GNode => ({
    ...(prev ?? {}),
    id: ev.id,
    type: ev.type,
    label: ev.label.trim().slice(0, 80),
    sub: ev.sub ?? prev?.sub,
    clusters: clusters.length ? clusters : prev?.clusters ?? [],
    entityType: ev.entityType ?? prev?.entityType,
    properties: properties ?? prev?.properties,
    lat: ev.lat ?? prev?.lat,
    lng: ev.lng ?? prev?.lng,
    source: ev.source ?? prev?.source,
    externalId: ev.externalId ?? prev?.externalId,
    photos: sanitizePhotos(ev.photos) ?? prev?.photos,
  });

  const idx = d.nodes.findIndex((n) => n.id === ev.id);
  if (idx >= 0) {
    const nodes = [...d.nodes];
    nodes[idx] = merged(nodes[idx]);
    return refreshDerived({ ...d, nodes });
  }
  return refreshDerived({ ...d, nodes: [...d.nodes, merged()] });
}

/** Merge or create an edge from a connector event. */
export function upsertEdge(d: Dataset, raw: EdgeUpsertEvent): Dataset {
  const ev = validateEdge(raw);
  const exists = d.links.some(
    (l) =>
      endId(l.source) === ev.source &&
      endId(l.target) === ev.target &&
      l.type === ev.type,
  );
  if (exists) return refreshDerived(d);

  const link: GLink = {
    id: `ing_${ev.source}_${ev.target}_${ev.type}`,
    source: ev.source,
    target: ev.target,
    type: ev.type,
    weight: ev.weight ?? 1,
    label: ev.label,
  };
  return refreshDerived({ ...d, links: [...d.links, link] });
}
