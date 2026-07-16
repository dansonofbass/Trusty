import type {
  Dataset,
  GLink,
  GNode,
  Recommendation,
  TasteCluster,
  WalletEntry,
} from "@constellation/graph-core";

// The browser talks to the same-origin BFF proxy, which authenticates the
// session and forwards to the internal gateway with the user's identity.
const GATEWAY = "/api/graphql";

/** Fields shared by every query/mutation that returns the live graph. */
const GRAPH_SELECTION = `
  meId
  nodes {
    id
    type
    label
    sub
    clusters
    isMe
    figure
    val
    sources {
      provider
      url
      title
      lang
      imageUrl
    }
    entityType
    properties
    lat
    lng
    source
    externalId
    photos
  }
  links {
    id
    source
    target
    type
    weight
    label
    scope
    userId
    supporters
  }
  recommendations {
    nodeId
    score
    via
    reason
  }
  wallet {
    balance
    earnedTotal
    ledger {
      delta
      reason
      at
      ref
    }
  }
`;

interface GraphPayload {
  meId: string;
  nodes: GNode[];
  links: GLink[];
  recommendations: Recommendation[];
  wallet?: {
    balance: number;
    earnedTotal: number;
    ledger?: { delta: number; reason: string; at: number; ref?: string }[];
  };
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(GATEWAY, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await r.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ message: string }>;
  } | null;
  if (!r.ok) throw new Error(`gateway responded ${r.status}`);
  if (body?.errors?.length) throw new Error(body.errors[0]?.message ?? "graphql error");
  if (!body?.data) throw new Error("gateway returned no data");
  return body.data;
}

function asDataset(g: GraphPayload): Dataset {
  return {
    meId: g.meId,
    nodes: g.nodes.map((n) => ({
      ...n,
      clusters: (n.clusters ?? []) as TasteCluster[],
    })),
    links: g.links,
    recommendations: g.recommendations,
    wallet: g.wallet
      ? {
          balance: g.wallet.balance,
          earnedTotal: g.wallet.earnedTotal,
          ledger: (g.wallet.ledger ?? []).map((e) => ({
            delta: e.delta,
            reason: e.reason as WalletEntry["reason"],
            at: e.at,
            ref: e.ref,
          })),
        }
      : undefined,
  };
}

export async function fetchGraph(): Promise<Dataset> {
  const data = await gql<{ graph: GraphPayload }>(`query { graph { ${GRAPH_SELECTION} } }`);
  return asDataset(data.graph);
}

export async function mutateAddEdge(source: string, target: string): Promise<Dataset> {
  const data = await gql<{ addEdge: GraphPayload }>(
    `mutation($source: ID!, $target: ID!) {
      addEdge(source: $source, target: $target) { ${GRAPH_SELECTION} }
    }`,
    { source, target },
  );
  return asDataset(data.addEdge);
}

export async function mutateRemoveEdge(source: string, target: string): Promise<Dataset> {
  const data = await gql<{ removeEdge: GraphPayload }>(
    `mutation($source: ID!, $target: ID!) {
      removeEdge(source: $source, target: $target) { ${GRAPH_SELECTION} }
    }`,
    { source, target },
  );
  return asDataset(data.removeEdge);
}

export async function mutateAcceptRec(userId: string, nodeId: string): Promise<Dataset> {
  const data = await gql<{ acceptRecommendation: GraphPayload }>(
    `mutation($userId: ID!, $nodeId: ID!) {
      acceptRecommendation(userId: $userId, nodeId: $nodeId) { ${GRAPH_SELECTION} }
    }`,
    { userId, nodeId },
  );
  return asDataset(data.acceptRecommendation);
}

export async function mutateDismissRec(userId: string, nodeId: string): Promise<Dataset> {
  const data = await gql<{ dismissRecommendation: GraphPayload }>(
    `mutation($userId: ID!, $nodeId: ID!) {
      dismissRecommendation(userId: $userId, nodeId: $nodeId) { ${GRAPH_SELECTION} }
    }`,
    { userId, nodeId },
  );
  return asDataset(data.dismissRecommendation);
}

export async function mutateAddEntityLink(
  userId: string,
  source: string,
  target: string,
  type: string,
  label?: string,
): Promise<Dataset> {
  const data = await gql<{ addEntityLink: GraphPayload }>(
    `mutation($userId: ID!, $source: ID!, $target: ID!, $type: String!, $label: String) {
      addEntityLink(userId: $userId, source: $source, target: $target, type: $type, label: $label) {
        ${GRAPH_SELECTION}
      }
    }`,
    { userId, source, target, type, label },
  );
  return asDataset(data.addEntityLink);
}

export async function mutateRemoveEntityLink(userId: string, linkId: string): Promise<Dataset> {
  const data = await gql<{ removeEntityLink: GraphPayload }>(
    `mutation($userId: ID!, $linkId: ID!) {
      removeEntityLink(userId: $userId, linkId: $linkId) { ${GRAPH_SELECTION} }
    }`,
    { userId, linkId },
  );
  return asDataset(data.removeEntityLink);
}

export async function mutateSpendTokens(
  amount: number,
  reason?: string,
  ref?: string,
): Promise<Dataset> {
  const data = await gql<{ spendTokens: GraphPayload }>(
    `mutation($amount: Float!, $reason: String, $ref: String) {
      spendTokens(amount: $amount, reason: $reason, ref: $ref) { ${GRAPH_SELECTION} }
    }`,
    { amount, reason, ref },
  );
  return asDataset(data.spendTokens);
}

export async function mutateEarnTokens(
  amount: number,
  reason?: string,
  ref?: string,
): Promise<Dataset> {
  const data = await gql<{ earnTokens: GraphPayload }>(
    `mutation($amount: Float!, $reason: String, $ref: String) {
      earnTokens(amount: $amount, reason: $reason, ref: $ref) { ${GRAPH_SELECTION} }
    }`,
    { amount, reason, ref },
  );
  return asDataset(data.earnTokens);
}

export async function mutateBuyTokens(amount?: number): Promise<Dataset> {
  const data = await gql<{ buyTokens: GraphPayload }>(
    `mutation($amount: Float) {
      buyTokens(amount: $amount) { ${GRAPH_SELECTION} }
    }`,
    { amount },
  );
  return asDataset(data.buyTokens);
}
