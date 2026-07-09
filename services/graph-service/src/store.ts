/**
 * Persistence for the social graph (multi-user).
 *
 * Two implementations behind one interface:
 *   • Neo4jStore  — durable storage in Neo4j (used when NEO4J_URI is set).
 *   • MemoryStore — non-durable in-process fallback (local dev without Neo4j).
 *
 * The model is ONE shared entity graph + PER-USER meta. Recommendations and
 * node sizes are derived (recomputed per-user on read), so we persist only the
 * shared nodes/edges and each user's little meta (meId + dismissed + wallet).
 *
 * Storage model in Neo4j:
 *   (:Entity {id, type, label, sub, clusters, isMe, body, extraction})
 *   (:Entity)-[:REL {id, type, weight, label, scope, userId, supporters}]->(:Entity)
 *   (:Meta {id:'meta:'+userId, userId, meId, dismissed, wallet})   ← one per user
 * Edges use a single relationship type `:REL` with the real edge type carried
 * as a property — so we never interpolate LLM-derived strings into Cypher.
 */
import neo4j, { type Driver } from "neo4j-driver";
import {
  buildDataset,
  STARTING_BALANCE,
  type EntitySource,
  type GLink,
  type GNode,
  type ThoughtExtraction,
  type Wallet,
} from "@constellation/graph-core";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** The shared substrate: every node + edge, visible to all (bounded per-view). */
export interface SharedGraph {
  nodes: GNode[];
  links: GLink[];
}

/** Per-user state: their root, dismissed recs, and token wallet. */
export interface UserMeta {
  meId: string;
  dismissed: string[];
  wallet: Wallet;
}

export function defaultWallet(): Wallet {
  return { balance: STARTING_BALANCE, earnedTotal: 0, ledger: [] };
}

export interface GraphStore {
  /** The shared graph: seeded on first run, loaded from storage afterwards. */
  loadGraph(): Promise<SharedGraph>;
  /** Persist the full shared graph (full sync — it's small). */
  persistGraph(g: SharedGraph): Promise<void>;
  /** A user's meta, or null if they have none yet (first login). */
  loadUserMeta(userId: string): Promise<UserMeta | null>;
  /** Persist a user's meta. */
  persistUserMeta(userId: string, meta: UserMeta): Promise<void>;
  close(): Promise<void>;
  readonly kind: "neo4j" | "memory";
}

/* ------------------------------ shaping ---------------------------- */

function nodeProps(n: GNode) {
  return {
    id: n.id,
    type: n.type,
    label: n.label,
    sub: n.sub ?? null,
    clusters: n.clusters ?? [],
    isMe: n.isMe === true,
    figure: n.figure === true,
    body: n.body ?? null,
    extraction: n.extraction ? JSON.stringify(n.extraction) : null,
    sources: n.sources?.length ? JSON.stringify(n.sources) : null,
    entityType: n.entityType ?? null,
    properties: n.properties ? JSON.stringify(n.properties) : null,
    source: n.source ?? null,
    externalId: n.externalId ?? null,
    lat: typeof n.lat === "number" ? n.lat : null,
    lng: typeof n.lng === "number" ? n.lng : null,
    photos: n.photos?.length ? n.photos : [],
  };
}

function linkProps(l: GLink) {
  return {
    id: l.id,
    source: endId(l.source),
    target: endId(l.target),
    type: l.type,
    weight: typeof l.weight === "number" ? l.weight : 1,
    label: l.label ?? null,
    scope: l.scope ?? "global",
    userId: l.userId ?? null,
    supporters: l.supporters?.length ? JSON.stringify(l.supporters) : null,
    trust: l.trust ? JSON.stringify(l.trust) : null,
    stage: l.stage ?? null,
  };
}

function parseNode(p: Record<string, unknown>): GNode {
  let extraction: ThoughtExtraction | undefined;
  if (typeof p.extraction === "string") {
    try {
      extraction = JSON.parse(p.extraction) as ThoughtExtraction;
    } catch {
      /* ignore malformed extraction */
    }
  }
  let sources: EntitySource[] | undefined;
  if (typeof p.sources === "string") {
    try {
      sources = JSON.parse(p.sources) as EntitySource[];
    } catch {
      /* ignore */
    }
  }
  let properties: Record<string, unknown> | undefined;
  if (typeof p.properties === "string") {
    try {
      properties = JSON.parse(p.properties) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {
    id: String(p.id),
    type: p.type as GNode["type"],
    label: String(p.label ?? ""),
    sub: typeof p.sub === "string" ? p.sub : undefined,
    clusters: Array.isArray(p.clusters) ? (p.clusters as GNode["clusters"]) : [],
    isMe: p.isMe === true || undefined,
    figure: p.figure === true || undefined,
    body: typeof p.body === "string" ? p.body : undefined,
    extraction,
    sources,
    entityType: typeof p.entityType === "string" ? p.entityType : undefined,
    properties,
    source: typeof p.source === "string" ? p.source : undefined,
    externalId: typeof p.externalId === "string" ? p.externalId : undefined,
    lat: typeof p.lat === "number" ? p.lat : undefined,
    lng: typeof p.lng === "number" ? p.lng : undefined,
    photos: Array.isArray(p.photos) && p.photos.length ? (p.photos as string[]) : undefined,
  };
}

function parseLink(p: Record<string, unknown>, source: string, target: string): GLink {
  let supporters: string[] | undefined;
  if (typeof p.supporters === "string") {
    try {
      supporters = JSON.parse(p.supporters) as string[];
    } catch {
      /* ignore */
    }
  }
  return {
    id: String(p.id),
    source,
    target,
    type: p.type as GLink["type"],
    weight: typeof p.weight === "number" ? p.weight : 1,
    label: typeof p.label === "string" ? p.label : undefined,
    scope: p.scope === "user" ? "user" : undefined,
    userId: typeof p.userId === "string" ? p.userId : undefined,
    supporters,
    trust: parseTrust(p.trust),
    stage: typeof p.stage === "string" ? p.stage : undefined,
  };
}

function parseTrust(v: unknown): GLink["trust"] {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as GLink["trust"];
  } catch {
    return undefined;
  }
}

function parseUserMeta(p: Record<string, unknown>): UserMeta {
  let wallet: Wallet | undefined;
  if (typeof p.wallet === "string") {
    try {
      wallet = JSON.parse(p.wallet) as Wallet;
    } catch {
      /* ignore */
    }
  }
  return {
    meId: typeof p.meId === "string" ? p.meId : String(p.userId ?? ""),
    dismissed: Array.isArray(p.dismissed) ? (p.dismissed as string[]) : [],
    wallet: wallet ?? defaultWallet(),
  };
}

const metaId = (userId: string) => `meta:${userId}`;

/* ------------------------------ Neo4j ------------------------------ */

export class Neo4jStore implements GraphStore {
  readonly kind = "neo4j" as const;
  private driver: Driver;

  private constructor(driver: Driver) {
    this.driver = driver;
  }

  static async connect(
    uri: string,
    user: string,
    password: string,
    { retries = 30, delayMs = 2000 }: { retries?: number; delayMs?: number } = {},
  ): Promise<Neo4jStore> {
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      disableLosslessIntegers: true,
    });
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await driver.verifyConnectivity();
        await driver.executeQuery(
          "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE",
        );
        // Backfill: people extracted from writing (cn_ ids) are public figures,
        // so they become entity-linkable without needing re-extraction.
        await driver.executeQuery(
          "MATCH (n:Entity {type:'person'}) WHERE n.id STARTS WITH 'cn_' AND n.figure IS NULL SET n.figure = true",
        );
        console.log(`graph-service: connected to Neo4j at ${uri}`);
        return new Neo4jStore(driver);
      } catch (e) {
        lastErr = e;
        console.log(
          `graph-service: waiting for Neo4j (${attempt}/${retries}) — ${
            e instanceof Error ? e.message : e
          }`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    await driver.close();
    throw new Error(
      `could not connect to Neo4j at ${uri} after ${retries} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  async loadGraph(): Promise<SharedGraph> {
    const { records } = await this.driver.executeQuery("MATCH (n:Entity) RETURN count(n) AS c");
    const count = records[0]?.get("c") ?? 0;

    if (!count) {
      // first run — lay down the deterministic seed world as the shared substrate.
      const seed = buildDataset(2026);
      const g: SharedGraph = { nodes: seed.nodes, links: seed.links };
      await this.persistGraph(g);
      console.log(`graph-service: seeded Neo4j with ${g.nodes.length} shared nodes`);
      return g;
    }

    const nodesRes = await this.driver.executeQuery("MATCH (n:Entity) RETURN n");
    const nodes = nodesRes.records.map((rec) =>
      parseNode(rec.get("n").properties as Record<string, unknown>),
    );

    const linksRes = await this.driver.executeQuery(
      "MATCH (a:Entity)-[r:REL]->(b:Entity) RETURN r, a.id AS source, b.id AS target",
    );
    const links = linksRes.records.map((rec) =>
      parseLink(rec.get("r").properties as Record<string, unknown>, String(rec.get("source")), String(rec.get("target"))),
    );

    return { nodes, links };
  }

  async persistGraph(g: SharedGraph): Promise<void> {
    const nodes = g.nodes.map(nodeProps);
    const ids = nodes.map((n) => n.id);
    const links = g.links.map(linkProps);
    const linkIds = links.map((l) => l.id);

    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `UNWIND $nodes AS n
           MERGE (x:Entity {id: n.id})
           SET x.type = n.type, x.label = n.label, x.sub = n.sub,
               x.clusters = n.clusters, x.isMe = n.isMe, x.figure = n.figure,
               x.body = n.body, x.extraction = n.extraction, x.sources = n.sources,
               x.entityType = n.entityType, x.properties = n.properties,
               x.source = n.source, x.externalId = n.externalId,
               x.lat = n.lat, x.lng = n.lng, x.photos = n.photos`,
          { nodes },
        );
        await tx.run("MATCH (x:Entity) WHERE NOT x.id IN $ids DETACH DELETE x", { ids });
        await tx.run(
          `UNWIND $links AS l
           MATCH (a:Entity {id: l.source}), (b:Entity {id: l.target})
           MERGE (a)-[r:REL {id: l.id}]->(b)
           SET r.type = l.type, r.weight = l.weight, r.label = l.label,
               r.scope = l.scope, r.userId = l.userId, r.supporters = l.supporters,
               r.trust = l.trust, r.stage = l.stage`,
          { links },
        );
        await tx.run("MATCH ()-[r:REL]->() WHERE NOT r.id IN $linkIds DELETE r", { linkIds });
      });
    } finally {
      await session.close();
    }
  }

  async loadUserMeta(userId: string): Promise<UserMeta | null> {
    const res = await this.driver.executeQuery("MATCH (m:Meta {id:$id}) RETURN m", {
      id: metaId(userId),
    });
    const p = res.records[0]?.get("m")?.properties as Record<string, unknown> | undefined;
    return p ? parseUserMeta(p) : null;
  }

  async persistUserMeta(userId: string, meta: UserMeta): Promise<void> {
    await this.driver.executeQuery(
      `MERGE (m:Meta {id:$id})
       SET m.userId = $userId, m.meId = $meId, m.dismissed = $dismissed, m.wallet = $wallet`,
      {
        id: metaId(userId),
        userId,
        meId: meta.meId,
        dismissed: meta.dismissed ?? [],
        wallet: JSON.stringify(meta.wallet ?? defaultWallet()),
      },
    );
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

/* ------------------------------ memory ----------------------------- */

/** Non-durable fallback so `npm run dev:graph` works without a database. */
export class MemoryStore implements GraphStore {
  readonly kind = "memory" as const;
  private metas = new Map<string, UserMeta>();

  async loadGraph(): Promise<SharedGraph> {
    const seed = buildDataset(2026);
    return { nodes: seed.nodes, links: seed.links };
  }
  async persistGraph(): Promise<void> {
    /* nothing to do — the working copy lives in graph-service memory */
  }
  async loadUserMeta(userId: string): Promise<UserMeta | null> {
    return this.metas.get(userId) ?? null;
  }
  async persistUserMeta(userId: string, meta: UserMeta): Promise<void> {
    this.metas.set(userId, meta);
  }
  async close(): Promise<void> {}
}

/* ------------------------------ factory ---------------------------- */

export async function createStore(): Promise<GraphStore> {
  const uri = process.env.NEO4J_URI;
  if (!uri) {
    console.warn(
      "graph-service: NEO4J_URI not set — using in-memory store (data will NOT persist).",
    );
    return new MemoryStore();
  }
  const user = process.env.NEO4J_USERNAME ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD ?? "neo4j";
  return Neo4jStore.connect(uri, user, password);
}
