"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ensureWallet,
  egoIds,
  ingestThought,
  heuristicExtract,
  linksForViewer,
  peekCost,
  toGraph,
  type Dataset,
  type GNode,
  type ThoughtExtraction,
  type Wallet,
} from "@constellation/graph-core";
import {
  createClient,
  resolveMode,
  type GraphClient,
  type SourceMode,
} from "@/lib/dataSource";
import { ingestExtraction, streamExtract, type ExtractStreamEvent } from "@/lib/extractClient";
import type { TrustAssertion } from "@/lib/trustClient";
import { logImpressions } from "@/lib/interactionClient";
import { useUI } from "@/lib/store";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/**
 * Merge a fresh dataset into the current one while PRESERVING object
 * identity for nodes/links that survived — that's what keeps the force
 * simulation from forgetting positions on every action (and what makes
 * re-entering /graph cheap: node objects keep their x/y). Brand-new nodes
 * are spawned at your position so they visibly emerge from You.
 */
function mergeDataset(prev: Dataset, next: Dataset): Dataset {
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const me = prevNodes.get(prev.meId);
  const nodes = next.nodes.map((n) => {
    const old = prevNodes.get(n.id);
    if (old) {
      old.label = n.label;
      old.sub = n.sub;
      old.val = n.val;
      old.clusters = n.clusters;
      old.sources = n.sources;
      old.body = n.body;
      old.extraction = n.extraction;
      return old;
    }
    if (me && me.x != null && me.y != null) {
      n.x = me.x + (Math.random() - 0.5) * 16;
      n.y = me.y - 24;
    }
    return n;
  });
  const prevLinks = new Map(prev.links.map((l) => [l.id, l]));
  const links = next.links.map((l) => prevLinks.get(l.id) ?? l);
  return { ...next, nodes, links };
}

export interface GraphData {
  mode: SourceMode;
  /** null while the first load is in flight. */
  data: Dataset | null;
  /** Never null — empty placeholder before the first load lands. */
  dataset: Dataset;
  loadError: string | null;
  pending: boolean;
  notice: string | null;
  setNotice: (n: string | null) => void;
  viewerLinks: Dataset["links"];
  graph: ReturnType<typeof toGraph>;
  nodeById: Map<string, GNode>;
  recsById: Map<string, Dataset["recommendations"][number]>;
  recIds: Set<string>;
  maxRecScore: number;
  directIds: Set<string>;
  follows: Set<string>;
  typeCounts: Record<string, number>;
  wallet: Wallet;
  connectedToMe: (id: string) => boolean;
  handleConnect: (id: string) => void;
  handleAcceptRec: (id: string) => void;
  handleDismissRec: (id: string) => void;
  handleAddEntityLink: (
    source: string,
    target: string,
    type: "SAME_AS" | "RELATES_TO",
    label?: string,
  ) => void;
  handleRemoveEntityLink: (linkId: string) => void;
  handlePeek: (centerId: string) => void;
  handleBuyTokens: () => void;
  handleExtract: (
    text: string,
    onEvent: (ev: ExtractStreamEvent) => void,
  ) => Promise<ThoughtExtraction | null>;
  handleWeave: (
    text: string,
    extraction: ThoughtExtraction,
    originalExtraction?: ThoughtExtraction,
    writingId?: string,
    trustAssertions?: TrustAssertion[],
  ) => Promise<{ entityCount: number; conceptIds: string[]; thoughtId: string } | null>;
}

const GraphDataContext = createContext<GraphData | null>(null);

export function useGraphData(): GraphData {
  const ctx = useContext(GraphDataContext);
  if (!ctx) throw new Error("useGraphData must be used inside GraphDataProvider");
  return ctx;
}

/**
 * Owns the dataset + every graph mutation for the workspace shell — extracted
 * from the old GraphExplorer so ALL center views (chat, docs, graph, discover)
 * share one world model. Mounted once in the (workspace) layout, so it
 * survives center-view navigation.
 */
export default function GraphDataProvider({ children }: { children: React.ReactNode }) {
  const [mode] = useState<SourceMode>(() => resolveMode());
  const clientRef = useRef<GraphClient | null>(null);
  if (!clientRef.current) clientRef.current = createClient(mode);

  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const graphNonce = useUI((s) => s.graphNonce);
  const select = useUI((s) => s.select);
  const removePeek = useUI((s) => s.removePeek);
  const addPeek = useUI((s) => s.addPeek);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);
  const setLinkPickFrom = useUI((s) => s.setLinkPickFrom);
  const setUser = useUI((s) => s.setUser);
  const user = useUI((s) => s.user);

  useEffect(() => {
    let alive = true;
    clientRef.current!.load()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [graphNonce]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  // Hydrate the signed-in identity (no-op in mock mode → 401).
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u?.sub && setUser(u))
      .catch(() => {});
  }, [setUser]);

  /* ------------------------------------------------------------ */
  /* World model (recomputed when the dataset changes)              */
  /* ------------------------------------------------------------ */

  const dataset = useMemo<Dataset>(
    () => data ?? { nodes: [], links: [], meId: "me", recommendations: [] },
    [data],
  );

  const viewerLinks = useMemo(() => linksForViewer(dataset, dataset.meId), [dataset]);

  const graph = useMemo(() => toGraph(dataset.nodes, viewerLinks), [dataset.nodes, viewerLinks]);

  const nodeById = useMemo(() => new Map(dataset.nodes.map((n) => [n.id, n])), [dataset]);

  const recsById = useMemo(
    () => new Map(dataset.recommendations.map((r) => [r.nodeId, r])),
    [dataset],
  );
  const recIds = useMemo(() => new Set(recsById.keys()), [recsById]);
  const maxRecScore = dataset.recommendations[0]?.score ?? 1;

  // Log which recs were actually shown (fatigue/CTR signal).
  useEffect(() => {
    if (!user) return;
    logImpressions(dataset.recommendations.map((r) => r.nodeId));
  }, [user, dataset.recommendations]);

  // Your direct sky: everything one hop from You — the NEAR band.
  const directIds = useMemo(() => {
    const s = new Set<string>();
    if (graph.hasNode(dataset.meId)) for (const nb of graph.neighbors(dataset.meId)) s.add(nb);
    return s;
  }, [graph, dataset.meId]);

  // People you're socially connected to — befriending one merges their galaxy.
  const follows = useMemo(() => {
    const s = new Set<string>();
    for (const id of directIds) if (nodeById.get(id)?.type === "person") s.add(id);
    return s;
  }, [directIds, nodeById]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of dataset.nodes) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [dataset]);

  const wallet = useMemo(() => ensureWallet(dataset), [dataset]);

  /* ------------------------------------------------------------ */
  /* Actions — every one is a graph mutation, in both modes         */
  /* ------------------------------------------------------------ */

  const runAction = useCallback(
    async (fn: (c: GraphClient) => Promise<Dataset>) => {
      if (pending || !data) return null;
      setPending(true);
      try {
        const next = await fn(clientRef.current!);
        const merged = mergeDataset(data, next);
        setData(merged);
        return merged;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [pending, data],
  );

  const connectedToMe = useCallback(
    (id: string) =>
      id !== dataset.meId &&
      graph.hasNode(id) &&
      graph.hasNode(dataset.meId) &&
      graph.hasEdge(dataset.meId, id),
    [graph, dataset.meId],
  );

  const handleConnect = useCallback(
    (id: string) => {
      const drop = connectedToMe(id);
      runAction((c) =>
        drop ? c.removeEdge(dataset.meId, id) : c.addEdge(dataset.meId, id),
      ).then((d) => {
        // Befriending the center of a peek converts it to a permanent merge.
        if (d && !drop) removePeek(id);
      });
    },
    [connectedToMe, runAction, dataset.meId, removePeek],
  );

  const handleAcceptRec = useCallback(
    (id: string) => {
      runAction((c) => c.acceptRec(dataset.meId, id)).then((d) => {
        if (d) setNotice("✦ Added to your sky — the ghost edge is now real.");
      });
    },
    [runAction, dataset.meId],
  );

  const handleDismissRec = useCallback(
    (id: string) => {
      runAction((c) => c.dismissRec(dataset.meId, id));
    },
    [runAction, dataset.meId],
  );

  const handleAddEntityLink = useCallback(
    (source: string, target: string, type: "SAME_AS" | "RELATES_TO", label?: string) => {
      runAction((c) => c.addEntityLink(dataset.meId, source, target, type, label)).then((d) => {
        if (d) {
          setNotice("✦ Local entity link added — visible in your sky.");
          setLinkPickFrom(null);
        }
      });
    },
    [runAction, dataset.meId, setLinkPickFrom],
  );

  const handleRemoveEntityLink = useCallback(
    (linkId: string) => {
      runAction((c) => c.removeEntityLink(dataset.meId, linkId));
    },
    [runAction, dataset.meId],
  );

  // Spend tokens to peek at a region you have no social path to. The spend
  // debits the durable wallet; the peek itself is ephemeral (fades on reload).
  const handlePeek = useCallback(
    (centerId: string) => {
      const radius = 1;
      const cost = peekCost(radius, egoIds(graph, centerId, radius).size);
      runAction((c) => c.spendTokens(cost, "peek", centerId)).then((d) => {
        if (!d) return; // insufficient funds → runAction surfaced the notice
        addPeek({ center: centerId, radius, cost, at: Date.now() });
        select(centerId);
        setNotice(`✦ Peeked for ${cost} — befriend someone here to keep it.`);
        requestGraphCenter(centerId);
      });
    },
    [graph, runAction, addPeek, select, requestGraphCenter],
  );

  const handleBuyTokens = useCallback(() => {
    runAction((c) => c.buyTokens()).then((d) => {
      if (d) setNotice("✦ Tokens added to your wallet.");
    });
  }, [runAction]);

  const finishIngest = useCallback(
    (merged: Dataset, thoughtId: string, conceptIds: string[], entityCount: number) => {
      setData(merged);
      setNotice(
        `✦ Wove ${entityCount} ${entityCount === 1 ? "entity" : "entities"} into your sky.`,
      );
      return { thoughtId, conceptIds, entityCount };
    },
    [],
  );

  const handleExtract = useCallback(
    async (text: string, onEvent: (ev: ExtractStreamEvent) => void) => {
      if (pending || !data) return null;
      setPending(true);
      try {
        if (mode === "api") {
          const streamed = await streamExtract(text, { onEvent });
          return streamed.extraction;
        }
        onEvent({ type: "phase", phase: "prepare", label: "Reading your text", progress: 8 });
        await new Promise((r) => setTimeout(r, 300));
        onEvent({ type: "phase", phase: "llm", label: "Heuristic extraction", progress: 25 });
        const extraction = heuristicExtract(text);
        const raw = JSON.stringify(extraction, null, 2);
        onEvent({ type: "token", content: raw });
        onEvent({ type: "phase", phase: "parse", label: "Parsing entities", progress: 72 });
        onEvent({ type: "done", via: "heuristic", extraction, rawModelOutput: raw });
        return extraction;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [pending, data, mode],
  );

  const handleWeave = useCallback(
    async (
      text: string,
      extraction: ThoughtExtraction,
      originalExtraction?: ThoughtExtraction,
      writingId?: string,
      trustAssertions?: TrustAssertion[],
    ) => {
      if (pending || !data) return null;
      setPending(true);
      try {
        const r =
          mode === "api"
            ? await ingestExtraction(
                data.meId,
                text,
                extraction,
                originalExtraction,
                writingId,
                trustAssertions,
              )
            : ingestThought(data, data.meId, text, extraction);

        const merged = mergeDataset(data, r.dataset);
        const entityCount = merged.links.filter(
          (l) => endId(l.source) === r.thoughtId && l.type === "MENTIONS",
        ).length;

        return finishIngest(merged, r.thoughtId, r.conceptIds, entityCount);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [pending, data, mode, finishIngest],
  );

  const value = useMemo<GraphData>(
    () => ({
      mode,
      data,
      dataset,
      loadError,
      pending,
      notice,
      setNotice,
      viewerLinks,
      graph,
      nodeById,
      recsById,
      recIds,
      maxRecScore,
      directIds,
      follows,
      typeCounts,
      wallet,
      connectedToMe,
      handleConnect,
      handleAcceptRec,
      handleDismissRec,
      handleAddEntityLink,
      handleRemoveEntityLink,
      handlePeek,
      handleBuyTokens,
      handleExtract,
      handleWeave,
    }),
    [
      mode,
      data,
      dataset,
      loadError,
      pending,
      notice,
      viewerLinks,
      graph,
      nodeById,
      recsById,
      recIds,
      maxRecScore,
      directIds,
      follows,
      typeCounts,
      wallet,
      connectedToMe,
      handleConnect,
      handleAcceptRec,
      handleDismissRec,
      handleAddEntityLink,
      handleRemoveEntityLink,
      handlePeek,
      handleBuyTokens,
      handleExtract,
      handleWeave,
    ],
  );

  return <GraphDataContext.Provider value={value}>{children}</GraphDataContext.Provider>;
}
