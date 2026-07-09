import {
  acceptRecommendation,
  addEdge,
  addUserEntityLink,
  buildDataset,
  buyTokens,
  createPost,
  dismissRecommendation,
  earnTokens,
  ensureWallet,
  heuristicExtract,
  ingestThought,
  removeEdge,
  removeUserEntityLink,
  spendTokens,
  type Dataset,
  type EntityLinkType,
  type ThoughtExtraction,
  type WalletEntry,
} from "@constellation/graph-core";
import {
  fetchGraph,
  mutateAcceptRec,
  mutateAddEdge,
  mutateAddEntityLink,
  mutateBuyTokens,
  mutateCreatePost,
  mutateDismissRec,
  mutateEarnTokens,
  mutateRemoveEdge,
  mutateRemoveEntityLink,
  mutateSpendTokens,
} from "./graphqlClient";

/**
 * Single integration point between the frontend and the backend.
 *
 * Two clients, one interface, identical behavior — both run the exact same
 * mutation + recommendation functions from @constellation/graph-core:
 *
 *  - mock: the deterministic seed universe, mutated in-browser.
 *  - api:  gateway GraphQL (:4000) for the graph; extractor REST (:4003) for Write.
 *
 * Mode is switchable at runtime (no rebuild):
 *   1. URL            ?source=api | ?source=mock
 *   2. localStorage   constellation:source   (the in-app toggle sets this)
 *   3. env            NEXT_PUBLIC_DATA_SOURCE  (set "mock" to opt back in)
 *   4. default        api  (the app runs against the live service estate)
 */
export type SourceMode = "mock" | "api";

const LS_KEY = "constellation:source";

export function resolveMode(): SourceMode {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("source");
    if (q === "api" || q === "mock") return q;
    const ls = window.localStorage.getItem(LS_KEY);
    if (ls === "api" || ls === "mock") return ls;
  }
  // API-first: only fall back to the in-browser mock when explicitly asked.
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "mock" ? "mock" : "api";
}

/** Persist the choice and reload clean (drops any ?source override). */
export function switchMode(next: SourceMode): void {
  window.localStorage.setItem(LS_KEY, next);
  window.location.href = window.location.pathname;
}

export interface IngestResult {
  dataset: Dataset;
  thoughtId: string;
  conceptIds: string[];
}

export interface GraphClient {
  readonly mode: SourceMode;
  load(): Promise<Dataset>;
  addEdge(source: string, target: string): Promise<Dataset>;
  removeEdge(source: string, target: string): Promise<Dataset>;
  createPost(authorId: string, label: string): Promise<Dataset>;
  acceptRec(userId: string, nodeId: string): Promise<Dataset>;
  dismissRec(userId: string, nodeId: string): Promise<Dataset>;
  /** Link two entities (local until promoted to global). */
  addEntityLink(
    userId: string,
    source: string,
    target: string,
    type: EntityLinkType,
    label?: string,
  ): Promise<Dataset>;
  removeEntityLink(userId: string, linkId: string): Promise<Dataset>;
  /** Spend tokens (e.g. to peek beyond your galaxy). Rejects if insufficient. */
  spendTokens(amount: number, reason: WalletEntry["reason"], ref?: string): Promise<Dataset>;
  /** Credit earned tokens. */
  earnTokens(amount: number, reason: WalletEntry["reason"], ref?: string): Promise<Dataset>;
  /** Top up the wallet (dev/prototype affordance). */
  buyTokens(amount?: number): Promise<Dataset>;
  /** Extract entities from writing and fold them into the graph. */
  ingestThought(authorId: string, text: string): Promise<IngestResult>;
}

/* ------------------------------ mock ------------------------------- */

function mockClient(): GraphClient {
  let data = buildDataset(2026);
  const commit = (next: Dataset) => {
    data = next;
    return Promise.resolve(data);
  };
  return {
    mode: "mock",
    load: () => Promise.resolve(data),
    addEdge: (s, t) => commit(addEdge(data, s, t)),
    removeEdge: (s, t) => commit(removeEdge(data, s, t)),
    createPost: (a, l) => commit(createPost(data, a, l)),
    acceptRec: (_u, n) => commit(acceptRecommendation(data, n)),
    dismissRec: (_u, n) => commit(dismissRecommendation(data, n)),
    addEntityLink: (userId, source, target, type, label) =>
      commit(addUserEntityLink(data, userId, source, target, type, label)),
    removeEntityLink: (userId, linkId) => commit(removeUserEntityLink(data, userId, linkId)),
    spendTokens: (amount, reason, ref) => commit(spendTokens(data, amount, reason, ref)),
    earnTokens: (amount, reason, ref) => commit(earnTokens(data, amount, reason, ref)),
    buyTokens: (amount) => commit(buyTokens(data, amount)),
    ingestThought: (authorId, text) => {
      // No API key in the browser → use the deterministic heuristic so the
      // pipeline works offline. Switch to api mode for real Claude extraction.
      const extraction: ThoughtExtraction = heuristicExtract(text);
      const r = ingestThought(data, authorId, text, extraction);
      data = r.dataset;
      return Promise.resolve(r);
    },
  };
}

/* ------------------------------- api ------------------------------- */

function apiClient(): GraphClient {
  // Server snapshot held so wallet ops have a base to mutate; once Part D/E land
  // the wallet round-trips via GraphQL and persists per-user server-side.
  let data: Dataset | null = null;
  const sync = (next: Dataset): Dataset => {
    const wallet = next.wallet ?? (data ? data.wallet : undefined) ?? ensureWallet(next);
    data = { ...next, wallet };
    return data;
  };

  return {
    mode: "api",
    load: () => fetchGraph().then(sync),
    addEdge: (source, target) => mutateAddEdge(source, target).then(sync),
    removeEdge: (source, target) => mutateRemoveEdge(source, target).then(sync),
    createPost: (authorId, label) => mutateCreatePost(authorId, label).then(sync),
    acceptRec: (userId, nodeId) => mutateAcceptRec(userId, nodeId).then(sync),
    dismissRec: (userId, nodeId) => mutateDismissRec(userId, nodeId).then(sync),
    addEntityLink: (userId, source, target, type, label) =>
      mutateAddEntityLink(userId, source, target, type, label).then(sync),
    removeEntityLink: (userId, linkId) => mutateRemoveEntityLink(userId, linkId).then(sync),
    // Wallet ops persist server-side (per-user :Meta) and round-trip the balance.
    spendTokens: (amount, reason, ref) => mutateSpendTokens(amount, reason, ref).then(sync),
    earnTokens: (amount, reason, ref) => mutateEarnTokens(amount, reason, ref).then(sync),
    buyTokens: (amount) => mutateBuyTokens(amount).then(sync),
    ingestThought: async (authorId, text) => {
      // BFF proxy → extractor → graph-service; returns the updated snapshot.
      const r = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorId, text }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? `extractor responded ${r.status}`);
      const ing = (body as { _ingested?: { thoughtId: string; conceptIds: string[] } })._ingested;
      return {
        dataset: sync(body as Dataset),
        thoughtId: ing?.thoughtId ?? "",
        conceptIds: ing?.conceptIds ?? [],
      };
    },
  };
}

export function createClient(mode: SourceMode = resolveMode()): GraphClient {
  return mode === "api" ? apiClient() : mockClient();
}

/** Back-compat helper (used by early code paths). */
export async function getDataset(): Promise<Dataset> {
  return createClient().load();
}
