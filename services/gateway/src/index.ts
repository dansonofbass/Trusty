/**
 * gateway — the single GraphQL door for clients.
 * Delegates to internal services over HTTP (graph-service today;
 * recommender, auth, connectors as they come online).
 */
import { createServer } from "node:http";
import { createSchema, createYoga } from "graphql-yoga";
import { GraphQLScalarType } from "graphql";

/** Pass-through JSON scalar for a Node's typed `properties` bag. */
const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value",
  serialize: (v) => v,
  parseValue: (v) => v,
});

const GRAPH = process.env.GRAPH_SERVICE_URL ?? "http://localhost:4001";
const PORT = Number(process.env.PORT ?? 4000);

const typeDefs = /* GraphQL */ `
  scalar JSON
  type Node {
    id: ID!
    type: String!
    label: String!
    sub: String
    clusters: [String!]!
    isMe: Boolean
    figure: Boolean
    val: Float
    sources: [EntitySource!]
    """Ontology class (e.g. "restaurant") — drives the trust-native place panel."""
    entityType: String
    """Typed attributes for the entity type (cuisine, price_range, hours, …)."""
    properties: JSON
    lat: Float
    lng: Float
    source: String
    externalId: String
    """Photo URLs (places connectors: OSM image / Wikimedia)."""
    photos: [String!]
  }
  type EntitySource {
    provider: String!
    url: String!
    title: String!
    lang: String
    imageUrl: String
  }
  type Link {
    id: ID!
    source: ID!
    target: ID!
    type: String!
    weight: Float!
    label: String
    scope: String
    userId: String
    supporters: [String!]
  }
  type Subgraph {
    center: ID!
    depth: Int!
    nodes: [Node!]!
    links: [Link!]!
  }
  type Recommendation {
    nodeId: ID!
    score: Float!
    via: [ID!]!
    reason: String!
  }
  type WalletEntry {
    delta: Float!
    reason: String!
    at: Float!
    ref: String
  }
  type Wallet {
    balance: Float!
    earnedTotal: Float!
    ledger: [WalletEntry!]
  }
  type Graph {
    meId: ID!
    nodes: [Node!]!
    links: [Link!]!
    recommendations: [Recommendation!]!
    wallet: Wallet
  }
  type Query {
    graph: Graph!
    ego(id: ID!, depth: Int = 2): Subgraph!
    recommendations(id: ID!): [Recommendation!]!
    search(q: String!): [Node!]!
  }
  type Mutation {
    """Befriend a person or add content to your sky — edge type is inferred."""
    addEdge(source: ID!, target: ID!): Graph!
    """Unfriend / remove from your sky."""
    removeEdge(source: ID!, target: ID!): Graph!
    """Cast a post into your sky."""
    createPost(authorId: ID!, label: String!): Graph!
    """Accept a recommendation — the ghost edge becomes a real one."""
    acceptRecommendation(userId: ID!, nodeId: ID!): Graph!
    """Dismiss a recommendation — never shown again."""
    dismissRecommendation(userId: ID!, nodeId: ID!): Graph!
    """Link two entities (local until consensus promotes to global)."""
    addEntityLink(userId: ID!, source: ID!, target: ID!, type: String!, label: String): Graph!
    """Remove your assertion on a local entity link."""
    removeEntityLink(userId: ID!, linkId: ID!): Graph!
    """Spend tokens (e.g. to peek beyond your galaxy)."""
    spendTokens(amount: Float!, reason: String, ref: String): Graph!
    """Credit earned tokens."""
    earnTokens(amount: Float!, reason: String, ref: String): Graph!
    """Top up the wallet (dev/prototype affordance)."""
    buyTokens(amount: Float): Graph!
  }
`;

/** Request context — the authenticated identity forwarded by the BFF. */
type Ctx = { userId?: string; name?: string; email?: string };

const call = async (path: string, ctx?: Ctx, init?: RequestInit) => {
  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      // graph-service trusts these from the gateway (internal network).
      ...(ctx?.userId ? { "x-user-id": ctx.userId } : {}),
      ...(ctx?.name ? { "x-user-name": encodeURIComponent(ctx.name) } : {}),
      ...(ctx?.email ? { "x-user-email": encodeURIComponent(ctx.email) } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `graph-service ${r.status} for ${path}`);
  return body;
};

// Links arrive with string endpoints from graph-service (in-memory ids).
const normalizeLinks = (links: Array<Record<string, unknown>>) =>
  links.map((l) => ({
    ...l,
    source: typeof l.source === "object" && l.source ? (l.source as { id: string }).id : l.source,
    target: typeof l.target === "object" && l.target ? (l.target as { id: string }).id : l.target,
  }));

const asGraph = (d: { links: Array<Record<string, unknown>> }) => ({
  ...d,
  links: normalizeLinks(d.links),
});

const schema = createSchema({
  typeDefs,
  resolvers: {
    JSON: JSONScalar,
    Query: {
      graph: async (_p: unknown, _a: unknown, c: Ctx) =>
        asGraph(await call("/api/graph", c)),
      ego: async (_p: unknown, a: { id: string; depth: number }, c: Ctx) =>
        asGraph(await call(`/api/ego/${encodeURIComponent(a.id)}?depth=${a.depth}`, c)),
      // The authenticated user's frontier — id arg is ignored in favor of context.
      recommendations: (_p: unknown, _a: { id: string }, c: Ctx) =>
        call(`/api/recommendations/${encodeURIComponent(c.userId ?? "")}`, c),
      search: (_p: unknown, a: { q: string }, c: Ctx) =>
        call(`/api/search?q=${encodeURIComponent(a.q)}`, c),
    },
    Mutation: {
      addEdge: async (_p: unknown, a: { source: string; target: string }, c: Ctx) =>
        asGraph(await call("/api/edges", c, { method: "POST", body: JSON.stringify(a) })),
      removeEdge: async (_p: unknown, a: { source: string; target: string }, c: Ctx) =>
        asGraph(await call("/api/edges", c, { method: "DELETE", body: JSON.stringify(a) })),
      // The post is authored by the authenticated user, not the client-supplied id.
      createPost: async (_p: unknown, a: { authorId: string; label: string }, c: Ctx) =>
        asGraph(
          await call("/api/posts", c, {
            method: "POST",
            body: JSON.stringify({ authorId: c.userId ?? a.authorId, label: a.label }),
          }),
        ),
      acceptRecommendation: async (_p: unknown, a: { userId: string; nodeId: string }, c: Ctx) =>
        asGraph(
          await call(`/api/recommendations/${encodeURIComponent(c.userId ?? a.userId)}/accept`, c, {
            method: "POST",
            body: JSON.stringify({ nodeId: a.nodeId }),
          }),
        ),
      dismissRecommendation: async (_p: unknown, a: { userId: string; nodeId: string }, c: Ctx) =>
        asGraph(
          await call(`/api/recommendations/${encodeURIComponent(c.userId ?? a.userId)}/dismiss`, c, {
            method: "POST",
            body: JSON.stringify({ nodeId: a.nodeId }),
          }),
        ),
      addEntityLink: async (
        _p: unknown,
        a: { userId: string; source: string; target: string; type: string; label?: string },
        c: Ctx,
      ) =>
        asGraph(
          await call("/api/entity-links", c, {
            method: "POST",
            body: JSON.stringify({ ...a, userId: c.userId ?? a.userId }),
          }),
        ),
      removeEntityLink: async (_p: unknown, a: { userId: string; linkId: string }, c: Ctx) =>
        asGraph(
          await call("/api/entity-links", c, {
            method: "DELETE",
            body: JSON.stringify({ ...a, userId: c.userId ?? a.userId }),
          }),
        ),
      spendTokens: async (_p: unknown, a: { amount: number; reason?: string; ref?: string }, c: Ctx) =>
        asGraph(await call("/api/wallet/spend", c, { method: "POST", body: JSON.stringify(a) })),
      earnTokens: async (_p: unknown, a: { amount: number; reason?: string; ref?: string }, c: Ctx) =>
        asGraph(await call("/api/wallet/earn", c, { method: "POST", body: JSON.stringify(a) })),
      buyTokens: async (_p: unknown, a: { amount?: number }, c: Ctx) =>
        asGraph(await call("/api/wallet/buy", c, { method: "POST", body: JSON.stringify(a) })),
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  // The authenticated user is forwarded by the BFF as X-User-Id (the gateway
  // trusts it on the internal network). Resolvers read it from context.
  context: ({ request }): Ctx => {
    const dec = (v: string | null) => {
      if (!v) return undefined;
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    };
    return {
      userId: request.headers.get("x-user-id") ?? undefined,
      name: dec(request.headers.get("x-user-name")),
      email: dec(request.headers.get("x-user-email")),
    };
  },
  // Browser (:3000) → gateway (:4000). whatwg-node CORS expects a string or array.
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-Id"],
  },
  plugins: [
    {
      onRequest({ url, endResponse }) {
        if (url.pathname === "/health") {
          return endResponse(
            new Response(JSON.stringify({ ok: true, service: "gateway", graph: GRAPH }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
      },
    },
  ],
});

createServer(yoga).listen(PORT, () =>
  console.log(`gateway → GraphQL (queries + mutations) at http://localhost:${PORT}/graphql`),
);
