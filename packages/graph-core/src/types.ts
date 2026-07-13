/**
 * Trusty — core graph taxonomy.
 *
 * Every entity on the platform is a node; every relationship is a typed edge.
 * This file is the single source of truth for that vocabulary, shared by the
 * web app, the graph-service, the recommender, and ingestion connectors.
 */

export type NodeType =
  | "person"
  | "book"
  | "news"
  | "music"
  | "video"
  | "social_account"
  | "post"
  | "movie"
  | "financial_signal"
  | "location"
  | "thought" // a thing the user wrote — an article, a note, a journal entry
  | "concept" // an entity/idea extracted from a thought by the model
  | "menu_item"; // a dish on a place's menu (PART_OF a restaurant/cafe)

export type EdgeType =
  | "FRIENDS_WITH" // person ↔ person
  | "READS" // person → book | news
  | "LISTENS_TO" // person → music
  | "WATCHES" // person → video | movie
  | "FOLLOWS" // person → social_account
  | "LIKES" // person → post
  | "POSTED" // person | social_account → post
  | "TRACKS" // person → financial_signal
  | "VISITED" // person → location
  | "RECOMMENDED" // system → frontier node (carries score + because-path)
  | "MENTIONS" // thought → concept | any node it refers to
  | "RELATES_TO" // concept ↔ concept (semantic relation found by the model)
  | "SAME_AS" // user/model asserts two entities are the same (incl. cross-language)
  | "REFLECTS_ON" // person → thought (you authored / are thinking through it)
  | "PART_OF" // menu_item → restaurant | cafe (a dish belongs to a place's menu)
  | "TRUSTS" // person → person | provider, directed + topic-scoped (Trust Graph)
  | "INVITED" // person → person, directed "registration origin" — NOT trust, NOT friendship
  | "MEMBER_OF" // person → org/startup (a founder/member belongs to a team)
  | "SAVED" // person → person, one-directional "saved this contact for follow-up"
  // Event relationship graph (Trusty Sevan) — relationships, not trust:
  | "USES" // person | startup → concept (technology they build with)
  | "NEEDS" // person | startup → concept (what they're looking for)
  | "OFFERS" // person | startup → concept (what they can provide, incl. APIs)
  | "INTERESTED_IN" // person → concept (interest / industry / market)
  | "ATTENDING" // person → workshop | session
  | "MET_AT"; // person → person (met at the event — the connection moment)

export type LinkScope = "global" | "user";

/** Interest clusters used by the seed generator to shape realistic communities. */
export type TasteCluster =
  | "tech_ai"
  | "cinema"
  | "persian_culture"
  | "finance"
  | "indie_music"
  | "travel"
  | "food";

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  /** One-line context shown in the inspector (author, ticker, handle…). */
  sub?: string;
  clusters: TasteCluster[];
  isMe?: boolean;
  /**
   * A public/historical figure (e.g. extracted from writing: "Albert Camus"),
   * as opposed to a social account (you, your friends). Figures behave like
   * entities — they can be SAME_AS / RELATES_TO linked; social people cannot.
   */
  figure?: boolean;
  /** Force-graph mutates these in the browser; declared for typing comfort. */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** Visual size hint, precomputed from degree. */
  val?: number;
  /** Community id assigned by Louvain (set client-side / by analytics). */
  community?: number;
  /** For `thought` nodes: the original prose the user wrote. */
  body?: string;
  /** For `thought` nodes: the structured extraction the model produced. */
  extraction?: ThoughtExtraction;
  /** External references (Wikipedia, …) resolved after extraction. */
  sources?: EntitySource[];
  /** Ontology semantic class (e.g. "restaurant", "property") — see ./ontology. */
  entityType?: string;
  /** Typed attributes for the entity type's schema (e.g. a property's bedrooms/price). */
  properties?: Record<string, unknown>;
  /** Geographic coordinates for place nodes (from places connectors) — WGS84. */
  lat?: number;
  lng?: number;
  /** Provenance for connector-ingested nodes: where it came from + its id there. */
  source?: string;
  externalId?: string;
  /** Photo URLs (from places connectors: OSM `image` tag, Wikimedia, …). */
  photos?: string[];
}

export type EntitySourceProvider = "wikipedia";

export interface EntitySource {
  provider: EntitySourceProvider;
  url: string;
  title: string;
  lang?: string;
  /** Wikipedia page thumbnail when resolved. */
  imageUrl?: string;
}

export interface GLink {
  id: string;
  source: string | GNode;
  target: string | GNode;
  type: EdgeType;
  weight: number;
  /** For RELATES_TO / SAME_AS: human-readable relation phrase. */
  label?: string;
  /** global = shared graph; user = private until promoted by consensus. */
  scope?: LinkScope;
  /** Owner when scope === "user". */
  userId?: string;
  /** Users who asserted this link (used for promotion to global). */
  supporters?: string[];
  /** Trust Graph payload — present only on TRUSTS edges. */
  trust?: TrustEdgeProps;
  /**
   * Meeting lifecycle on SAVED edges (Trusty Sevan): discovered → interested →
   * met → conversation → follow_up → opportunity → pilot → partnership →
   * long_term → trust. Trust is the *final* stage, not the starting signal.
   */
  stage?: string;
  /** SAVED-contact reason tags (Trusty Sevan) — a contact can have several
   *  (potential_investor + potential_mentor, …). `label` mirrors `labels[0]`. */
  labels?: string[];
}

/**
 * Where a trust relationship applies. Structured from day one so the shape never
 * has to migrate, but V1 only *matches* on `topic` (+ optional `geo`); the rest
 * is stored and surfaced. (Doc §3 — Trust Scope.)
 */
export interface TrustScope {
  /** Curated topic from the taxonomy, e.g. "broker", "restaurant". */
  topic: string;
  /** Concrete entity/provider type, e.g. "restaurant" under domain "food". */
  entity?: string;
  /** Decision context, e.g. "date_night", "remote_work". */
  context?: string;
  /** Preference tags, e.g. ["quiet","premium"] — stored, unused in V1 matching. */
  preferences?: string[];
  /** Location key, e.g. "yerevan". */
  geo?: string;
}

/** The payload carried on a TRUSTS edge (Doc §10 — Trust Edge). */
export interface TrustEdgeProps {
  scope: TrustScope;
  /** Base trust 0..1. */
  confidence: number;
  /** Predefined reason codes (Doc §11 — no free text in V1). */
  reasons: string[];
  source: "explicit" | "extracted";
  /** Rolling outcome signal in [-1,1], cached from the outcome log. */
  outcome?: number;
  interactionCount?: number;
  createdAt: number;
  lastUpdate: number;
  /** Optional — users are never forced to provide it (Doc §10). */
  evidence?: string[];
  /** Optional free-text note the truster left ("great for date night") — the
   *  trust-native equivalent of a short review; surfaced on the detail panel. */
  note?: string;
}

export interface Recommendation {
  nodeId: string;
  score: number;
  /** Friend ids forming the visible "because" path: me → via[i] → node. */
  via: string[];
  reason: string;
  /** For trust recommendations: the trust path that produced this (Doc §8). */
  trustPath?: TrustPathHop[];
  /** Blend breakdown (which signals moved this rec), most-influential first. */
  factors?: RecFactor[];
}

/** One channel's signed contribution to a blended recommendation score. */
export interface RecFactor {
  channel: string;
  contribution: number;
}

export interface TrustPathHop {
  /** The edge id for this hop (used to record outcome feedback on trust hops). */
  edgeId: string;
  from: string;
  to: string;
  topic: string;
  confidence: number;
  /** "trust" = a TRUSTS edge; "friend" = a FRIENDS_WITH bridge. */
  kind: "trust" | "friend";
}

export interface CommunityInfo {
  id: number;
  label: string;
  size: number;
  memberIds: string[];
  color: string;
}


/* ------------------------------------------------------------------ */
/* Thought extraction — the model→graph contract                       */
/* ------------------------------------------------------------------ */

/** One entity the model pulled out of a thought. */
export interface ExtractedEntity {
  name: string;
  /** Verbatim span from the source text (for highlighting in the Write view). */
  mention?: string;
  kind:
    | "concept"
    | "person"
    | "book"
    | "movie"
    | "music"
    | "location"
    | "organization"
    | "technology"
    | "event"
    | "work"
    // Trusty Sevan meeting-note taxonomy (all render as `concept` nodes):
    | "need"
    | "api"
    | "skill"
    | "idea"
    | "market"
    | "startup"
    | "investor"
    | "mentor"
    | "country";
  cluster?: TasteCluster;
  salience?: number;
  /** Resolved links to external knowledge bases (Wikipedia, …). */
  sources?: EntitySource[];
}

/** A relation the model found between two extracted entities. */
export interface ExtractedRelation {
  source: string;
  target: string;
  label: string;
}

/** The whole structured result for one article/thought. */
export interface ThoughtExtraction {
  title?: string;
  summary?: string;
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/** A single grant or spend on the viewer's token wallet. */
export interface WalletEntry {
  /** Positive = earned/bought, negative = spent. */
  delta: number;
  reason: "start" | "buy" | "thought" | "promotion" | "peek";
  /** Epoch ms; non-deterministic — keep out of snapshot fixtures. */
  at: number;
  /** Node / link / peek-center this entry refers to, when relevant. */
  ref?: string;
}

/**
 * The viewer's token balance. Tokens gate exploration beyond your social
 * galaxy: you spend them to peek at distant neighborhoods and earn them by
 * contributing to the shared graph (writing, links admitted to global).
 */
export interface Wallet {
  /** Spendable tokens. */
  balance: number;
  /** Lifetime tokens earned through contribution (excludes buys). */
  earnedTotal: number;
  /** Recent activity, newest last (capped). */
  ledger?: WalletEntry[];
}

export interface Dataset {
  nodes: GNode[];
  links: GLink[];
  meId: string;
  recommendations: Recommendation[];
  /** Recommendation ids the user dismissed — excluded from future frontiers. */
  dismissed?: string[];
  /** The viewer's token wallet (persistent per-user state). */
  wallet?: Wallet;
}

/** Verb used when a person connects to a given node type. */
export const EDGE_VERB_FOR_TYPE: Record<Exclude<NodeType, "person">, EdgeType> = {
  book: "READS",
  news: "READS",
  music: "LISTENS_TO",
  video: "WATCHES",
  movie: "WATCHES",
  social_account: "FOLLOWS",
  post: "LIKES",
  financial_signal: "TRACKS",
  location: "VISITED",
  thought: "REFLECTS_ON",
  concept: "MENTIONS",
  menu_item: "LIKES",
};

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  person: "People",
  book: "Books",
  news: "News",
  music: "Music",
  video: "Videos",
  social_account: "Accounts",
  post: "Posts",
  movie: "Movies",
  financial_signal: "Signals",
  location: "Places",
  thought: "Thoughts",
  concept: "Concepts",
  menu_item: "Menu",
};
