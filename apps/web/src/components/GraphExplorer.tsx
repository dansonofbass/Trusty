"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeCommunities,
  egoIds,
  ensureWallet,
  entityLinksForNode,
  ENTITY_LINK_PROMOTION_THRESHOLD,
  heuristicExtract,
  ingestThought,
  linksForViewer,
  peekCost,
  shortestPath,
  toGraph,
  visibleIds,
  type Dataset,
  type GLink,
  type GNode,
  type ThoughtExtraction,
} from "@constellation/graph-core";
import {
  createClient,
  resolveMode,
  switchMode,
  type GraphClient,
  type SourceMode,
} from "@/lib/dataSource";
import { ingestExtraction, streamExtract, type ExtractStreamEvent } from "@/lib/extractClient";
import type { TrustAssertion } from "@/lib/trustClient";
import { communityColor } from "@/lib/palette";
import { useUI } from "@/lib/store";
import GraphCanvas, { type CanvasApi } from "./GraphCanvas";
import TopBar from "./TopBar";
import LeftRail from "./LeftRail";
import FeedPanel from "./FeedPanel";
import Composer from "./Composer";
import { Radio, SlidersHorizontal } from "lucide-react";
import Inspector from "./Inspector";
import PlaceModalHost from "./PlaceModalHost";
import HintBar from "./HintBar";
import ThoughtComposer from "./ThoughtComposer";
import EntityLinkPicker from "./EntityLinkPicker";
import { logImpressions } from "@/lib/interactionClient";
import LayerToggle from "./LayerToggle";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

function LoadingSky() {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="text-center">
        <div
          className="pulse-dot text-[15px] font-bold tracking-[0.3em] text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          CONSTELLATION
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-faint)]">charting your universe…</p>
      </div>
    </div>
  );
}

/**
 * Merge a fresh dataset into the current one while PRESERVING object
 * identity for nodes/links that survived — that's what keeps the force
 * simulation from forgetting positions on every action. Brand-new nodes
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

export default function GraphExplorer() {
  const [mode] = useState<SourceMode>(() => resolveMode());
  const clientRef = useRef<GraphClient | null>(null);
  if (!clientRef.current) clientRef.current = createClient(mode);

  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Feed dual-view (#36): the list is the DEFAULT left companion of the graph;
  // the Lens (type filters) collapses to a pill and opens on demand.
  const [feedOpen, setFeedOpen] = useState(true);
  const [lensOpen, setLensOpen] = useState(false);
  const [feedMatch, setFeedMatch] = useState<Set<string> | null>(null);

  const graphNonce = useUI((s) => s.graphNonce);
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

  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const selectedId = useUI((s) => s.selectedId);
  const focusId = useUI((s) => s.focusId);
  const hiddenTypes = useUI((s) => s.hiddenTypes);
  const layers = useUI((s) => s.layers);
  const toggleLayer = useUI((s) => s.toggleLayer);
  const trustSearch = useUI((s) => s.trustSearch);
  const trustFocusId = useUI((s) => s.trustFocusId);
  const circleFilter = useUI((s) => s.circleFilter);
  const pathPick = useUI((s) => s.pathPick);
  const select = useUI((s) => s.select);
  const setFocus = useUI((s) => s.setFocus);
  const toggleType = useUI((s) => s.toggleType);
  const pickPathNode = useUI((s) => s.pickPathNode);
  const tracePathTo = useUI((s) => s.tracePathTo);
  const resetAll = useUI((s) => s.resetAll);
  const linkPickFrom = useUI((s) => s.linkPickFrom);
  const setLinkPickFrom = useUI((s) => s.setLinkPickFrom);
  const peeks = useUI((s) => s.peeks);
  const addPeek = useUI((s) => s.addPeek);
  const removePeek = useUI((s) => s.removePeek);
  const setUser = useUI((s) => s.setUser);
  const user = useUI((s) => s.user);

  // Onboarding now lives on the dedicated /onboarding route (a new user reaches
  // Home only after completing it — enforced by the access gate). The old
  // in-canvas wizard has been retired.

  // Hydrate the signed-in identity for the header (no-op in mock mode → 401).
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u?.sub && setUser(u))
      .catch(() => {});
  }, [setUser]);

  const [linkPickTarget, setLinkPickTarget] = useState<string | null>(null);
  const apiRef = useRef<CanvasApi | null>(null);

  /* ------------------------------------------------------------ */
  /* World model (recomputed when the dataset changes)              */
  /* ------------------------------------------------------------ */

  const dataset = data ?? { nodes: [], links: [], meId: "me", recommendations: [] };

  const viewerLinks = useMemo(
    () => linksForViewer(dataset, dataset.meId),
    [dataset],
  );

  const graph = useMemo(() => toGraph(dataset.nodes, viewerLinks), [dataset.nodes, viewerLinks]);

  const communities = useMemo(() => {
    if (dataset.nodes.length === 0) return { byNode: {}, infos: [] };
    const c = computeCommunities(graph, dataset.nodes, 7);
    c.infos.forEach((i) => (i.color = communityColor(i.id)));
    dataset.nodes.forEach((n) => (n.community = c.byNode[n.id]));
    return c;
  }, [graph, dataset]);

  const nodeById = useMemo(
    () => new Map(dataset.nodes.map((n) => [n.id, n])),
    [dataset],
  );

  const recsById = useMemo(
    () => new Map(dataset.recommendations.map((r) => [r.nodeId, r])),
    [dataset],
  );
  const recIds = useMemo(() => new Set(recsById.keys()), [recsById]);
  const maxRecScore = dataset.recommendations[0]?.score ?? 1;

  // Log which recs were actually shown (fatigue/CTR signal). Deduped + debounced
  // client-side; only in api mode (a signed-in user), no-op otherwise.
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

  // People you're socially connected to — befriending one merges their galaxy
  // into yours (their own 2-hop bubble folds into what you can see).
  const follows = useMemo(() => {
    const s = new Set<string>();
    for (const id of directIds) if (nodeById.get(id)?.type === "person") s.add(id);
    return s;
  }, [directIds, nodeById]);


  // The bounded galaxy you can currently see: your 2-hop ego ∪ each friend's
  // IMMEDIATE neighborhood (followRadius 1, so a few hub friends don't unbound
  // it) ∪ active peeks ∪ your recommendation frontier. A fresh user with no
  // connections sees just themselves and onboards by searching + connecting.
  const universeIds = useMemo(() => {
    const ids = visibleIds(graph, dataset.meId, { radius: 2, followRadius: 1, follows, peeks });
    for (const id of recIds) ids.add(id); // recs are your frontier — always shown
    // Providers you personally trust belong in your galaxy, but TRUSTS edges are
    // excluded from the visibility graph (toGraph), so a node you ONLY trust
    // would be an invisible island. Pull your direct trust targets in — gated by
    // the Trust layer, so its edge renders too (and toggling off removes both).
    if (layers.trust) {
      for (const l of dataset.links) {
        if (l.type !== "TRUSTS") continue;
        if ((typeof l.source === "string" ? l.source : l.source.id) === dataset.meId) {
          ids.add(typeof l.target === "string" ? l.target : l.target.id);
        }
      }
    }
    return ids;
  }, [graph, dataset.meId, dataset.links, follows, peeks, recIds, layers.trust]);

  // Visible nodes that still have neighbors beyond the bound — the edge of the
  // known, where a peek reveals what's past it. Computed over the type-unfiltered
  // visible set so hiding a type doesn't change what counts as frontier.
  const frontierIds = useMemo(() => {
    const s = new Set<string>();
    for (const id of universeIds) {
      if (!graph.hasNode(id)) continue;
      let hasHidden = false;
      graph.forEachNeighbor(id, (nbr) => {
        if (!universeIds.has(nbr)) hasHidden = true;
      });
      if (hasHidden) s.add(id);
    }
    return s;
  }, [graph, universeIds]);

  // Ghost RECOMMENDED edges with stable ids so the sim doesn't churn.
  const recLinks = useMemo<GLink[]>(
    () =>
      dataset.recommendations.map((r) => ({
        id: `rec-${r.nodeId}`,
        source: dataset.meId,
        target: r.nodeId,
        type: "RECOMMENDED",
        weight: r.score,
      })),
    [dataset],
  );

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of dataset.nodes) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [dataset]);

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
        // Befriending the center of a peek converts it to a permanent social
        // merge — the ephemeral peek is now redundant.
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
          setLinkPickTarget(null);
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
        setTimeout(() => apiRef.current?.centerOn(centerId), 220);
      });
    },
    [graph, runAction, addPeek, select],
  );

  const handleBuyTokens = useCallback(() => {
    runAction((c) => c.buyTokens()).then((d) => {
      if (d) setNotice("✦ Tokens added to your wallet.");
    });
  }, [runAction]);

  const handleCreatePost = useCallback(
    async (text: string) => {
      const prevIds = new Set(dataset.nodes.map((n) => n.id));
      const d = await runAction((c) => c.createPost(dataset.meId, text));
      if (!d) return false;
      const fresh = d.nodes.find((n) => !prevIds.has(n.id));
      if (fresh) {
        select(fresh.id);
        setTimeout(() => apiRef.current?.centerOn(fresh.id), 500);
      }
      return true;
    },
    [runAction, dataset, select],
  );

  const finishIngest = useCallback(
    (
      merged: Dataset,
      thoughtId: string,
      conceptIds: string[],
      entityCount: number,
    ) => {
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
        onEvent({
          type: "done",
          via: "heuristic",
          extraction,
          rawModelOutput: raw,
        });
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
            ? await ingestExtraction(data.meId, text, extraction, originalExtraction, writingId, trustAssertions)
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

  const handleExploreThought = useCallback(
    (thoughtId: string) => {
      setFocus(thoughtId);
      select(thoughtId);
      setView("universe");
      setTimeout(() => apiRef.current?.centerOn(thoughtId), 560);
    },
    [setFocus, select, setView],
  );

  /* ------------------------------------------------------------ */
  /* Visible universe per view / lens / focus                      */
  /* ------------------------------------------------------------ */

  // Synthetic trust subgraph from the active search — node ids on the trust
  // paths + one orange edge per hop (these edges aren't in the viewer's data).
  const trustOverlay = useMemo(() => {
    if (!trustSearch || trustSearch.recs.length === 0) return null;
    const nodeIds = new Set<string>([dataset.meId]);
    const links: GLink[] = [];
    const seen = new Set<string>();
    for (const r of trustSearch.recs) {
      nodeIds.add(r.nodeId);
      for (const h of r.trustPath ?? []) {
        nodeIds.add(h.from);
        nodeIds.add(h.to);
        const key = `${h.from}>${h.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          id: `tsl_${h.edgeId}`,
          source: h.from,
          target: h.to,
          type: "TRUSTS",
          weight: h.confidence,
        });
      }
    }
    return { nodeIds, links };
  }, [trustSearch, dataset.meId]);

  const { visNodes, visLinks } = useMemo(() => {
    const hidden = new Set(hiddenTypes);
    let idSet: Set<string>;

    if (focusId && graph.hasNode(focusId)) {
      // Focus: enter a node's own neighborhood, independent of the galaxy bound.
      const depth = ["person", "thought"].includes(nodeById.get(focusId)?.type ?? "") ? 2 : 1;
      idSet = egoIds(graph, focusId, depth);
    } else if (view === "circles" && circleFilter != null) {
      // One community, clipped to your galaxy.
      const info = communities.infos.find((i) => i.id === circleFilter);
      idSet = new Set((info?.memberIds ?? []).filter((id) => universeIds.has(id)));
    } else if (view === "path" && pathPick.length === 2) {
      // Reveal ONLY the route's nodes beyond your galaxy — never the whole graph.
      const p = shortestPath(graph, pathPick[0], pathPick[1]);
      idSet = new Set(universeIds);
      if (p) for (const id of p) idSet.add(id);
    } else {
      // universe, discover, circles-overview, path-picking: your bounded galaxy.
      idSet = universeIds;
    }

    const visNodes = dataset.nodes.filter(
      (n) =>
        !hidden.has(n.type) &&
        idSet.has(n.id) &&
        // Knowledge layer off → hide extracted thought/concept nodes.
        (layers.knowledge || (n.type !== "thought" && n.type !== "concept")),
    );
    const vis = new Set(visNodes.map((n) => n.id));
    let visLinks = viewerLinks.filter((l) => {
      if (!vis.has(endId(l.source)) || !vis.has(endId(l.target))) return false;
      if (!layers.trust && l.type === "TRUSTS") return false;
      if (
        !layers.knowledge &&
        (l.type === "MENTIONS" || l.type === "RELATES_TO" || l.type === "REFLECTS_ON" || l.type === "SAME_AS")
      )
        return false;
      return true;
    });
    if ((view === "discover" || view === "universe") && !focusId) {
      visLinks = [
        ...visLinks,
        ...recLinks.filter((l) => vis.has(endId(l.target)) && vis.has(endId(l.source))),
      ];
    }

    // Trust-search overlay: reveal the path people (even beyond the galaxy) and
    // draw the trust path as synthetic orange edges so the search animates here.
    if (trustOverlay) {
      const outNodes = [...visNodes];
      for (const id of trustOverlay.nodeIds) {
        if (!vis.has(id)) {
          const n = nodeById.get(id);
          if (n) {
            outNodes.push(n);
            vis.add(id);
          }
        }
      }
      const outLinks = [
        ...visLinks,
        ...trustOverlay.links.filter((l) => vis.has(endId(l.source)) && vis.has(endId(l.target))),
      ];
      return { visNodes: outNodes, visLinks: outLinks };
    }
    return { visNodes, visLinks };
  }, [dataset, viewerLinks, graph, nodeById, hiddenTypes, layers, focusId, view, circleFilter, communities, recLinks, universeIds, pathPick, trustOverlay]);

  /* ------------------------------------------------------------ */
  /* Highlights: selection halo, because-paths, traced paths       */
  /* ------------------------------------------------------------ */

  const linkKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of visLinks) {
      const s = endId(l.source);
      const t = endId(l.target);
      m.set(`${s}>${t}`, l.id);
      m.set(`${t}>${s}`, l.id);
    }
    return m;
  }, [visLinks]);

  const { highlightNodes, highlightLinks, pathNodes, pathMissing } = useMemo(() => {
    let highlightNodes: Set<string> | null = null;
    let highlightLinks: Set<string> | null = null;
    let pathNodes: GNode[] | null = null;
    let pathMissing = false;

    const addLinkBetween = (set: Set<string>, a: string, b: string) => {
      const id = linkKey.get(`${a}>${b}`);
      if (id) set.add(id);
    };

    if (trustOverlay) {
      // Light up the whole trust subgraph (the search result); dim everything else.
      highlightNodes = new Set(trustOverlay.nodeIds);
      highlightLinks = new Set(trustOverlay.links.map((l) => l.id));
      return { highlightNodes, highlightLinks, pathNodes: null, pathMissing: false };
    }

    if (view === "path" && pathPick.length === 2) {
      const p = shortestPath(graph, pathPick[0], pathPick[1]);
      if (p) {
        highlightNodes = new Set(p);
        highlightLinks = new Set();
        for (let i = 0; i < p.length - 1; i++) addLinkBetween(highlightLinks, p[i], p[i + 1]);
        pathNodes = p.map((id) => nodeById.get(id)).filter((n): n is GNode => !!n);
      } else {
        highlightNodes = new Set(pathPick);
        pathMissing = true;
      }
    } else if (selectedId) {
      const rec = view === "discover" || view === "universe" ? recsById.get(selectedId) : undefined;
      if (rec) {
        highlightNodes = new Set([dataset.meId, ...rec.via, selectedId]);
        highlightLinks = new Set();
        for (const v of rec.via) {
          addLinkBetween(highlightLinks, dataset.meId, v);
          addLinkBetween(highlightLinks, v, selectedId);
        }
        addLinkBetween(highlightLinks, dataset.meId, selectedId); // ghost edge
      } else if (graph.hasNode(selectedId)) {
        highlightNodes = new Set([selectedId, ...graph.neighbors(selectedId)]);
        highlightLinks = new Set();
        for (const l of visLinks) {
          const s = endId(l.source);
          const t = endId(l.target);
          if (s === selectedId || t === selectedId) highlightLinks.add(l.id);
        }
      }
    }

    // Feed dual-view sync: an active list filter lights up its graph nodes
    // (Airbnb-style list↔map). Selection and overlays take precedence.
    if (!highlightNodes && feedMatch && feedMatch.size > 0) {
      highlightNodes = new Set(feedMatch);
      highlightLinks = new Set();
      for (const l of visLinks) {
        if (feedMatch.has(endId(l.source)) && feedMatch.has(endId(l.target)))
          highlightLinks.add(l.id);
      }
    }

    return { highlightNodes, highlightLinks, pathNodes, pathMissing };
  }, [view, pathPick, selectedId, graph, recsById, dataset.meId, nodeById, visLinks, linkKey, trustOverlay, feedMatch]);

  // Trust search → graph animation: frame the top result when results land, and
  // fly to whichever result the user hovers in the panel.
  useEffect(() => {
    const top = trustSearch?.recs[0]?.nodeId;
    if (!top) return;
    const t = setTimeout(() => apiRef.current?.centerOn(top), 520);
    return () => clearTimeout(t);
  }, [trustSearch]);

  useEffect(() => {
    if (trustFocusId) apiRef.current?.centerOn(trustFocusId);
  }, [trustFocusId]);

  /* ------------------------------------------------------------ */
  /* Handlers                                                       */
  /* ------------------------------------------------------------ */

  // Ids actually rendered right now (after the bound + type filters).
  const renderedIds = useMemo(() => new Set(visNodes.map((n) => n.id)), [visNodes]);

  const handleSelect = (id: string | null) => {
    if (id && linkPickFrom) {
      if (id === linkPickFrom) {
        setLinkPickFrom(null);
        setLinkPickTarget(null);
        select(null);
        return;
      }
      const n = nodeById.get(id);
      if (n && (n.type !== "person" || n.figure)) {
        setLinkPickTarget(id);
        select(id);
        return;
      }
    }
    if (id && view === "path") pickPathNode(id);
    select(id);
  };

  const handleJump = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    if (universeIds.has(id)) {
      if (!renderedIds.has(id)) {
        // In your galaxy but filtered out — reveal by unhiding its type / focus.
        if (hiddenTypes.includes(n.type)) toggleType(n.type);
        if (focusId) setFocus(null);
      }
      select(id);
      setTimeout(() => apiRef.current?.centerOn(id), 160);
    } else {
      // Out of your galaxy (e.g. a catalog restaurant with no edges yet): focus
      // its own neighborhood so it actually RENDERS on the canvas, and open the
      // Inspector (→ ✦ Trust it). setFocus also selects it.
      setFocus(id);
      setTimeout(() => apiRef.current?.centerOn(id), 240);
    }
  };

  // Esc walks back: focus → selection → path picks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useUI.getState();
      if (s.focusId) s.setFocus(null);
      else if (s.linkPickFrom) {
        s.setLinkPickFrom(null);
        setLinkPickTarget(null);
      } else if (s.selectedId) s.select(null);
      else if (s.pathPick.length) s.clearPath();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loadError) {
    return (
      <main className="grid h-screen w-screen place-items-center px-6">
        <div className="panel max-w-md rounded-2xl p-6 text-center">
          <p className="eyebrow mb-2">Signal lost</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-dim)]">
            Couldn&apos;t reach the graph in <b>api</b> mode: {loadError}. Start it with{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>npm run dev:graph</span>, or
            explore the in-browser universe instead.
          </p>
          <button className="btn btn-gold mx-auto mt-4" onClick={() => switchMode("mock")}>
            Switch to mock data
          </button>
        </div>
      </main>
    );
  }

  if (!data) return <LoadingSky />;

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const selectedEntityLinks = selectedId
    ? entityLinksForNode(dataset, selectedId, dataset.meId)
    : [];
  const linkFromNode = linkPickFrom ? nodeById.get(linkPickFrom) ?? null : null;
  const linkToNode = linkPickTarget ? nodeById.get(linkPickTarget) ?? null : null;

  // Peek affordance: offered for nodes outside your galaxy (reached via search)
  // and for frontier nodes (visible but with hidden neighbors beyond them).
  const selectedIsFrontier = selectedId ? frontierIds.has(selectedId) : false;
  const selectedPeekable =
    !!selectedNode &&
    !selectedNode.isMe &&
    (!universeIds.has(selectedNode.id) || selectedIsFrontier);
  const selectedPeekCost =
    selectedNode && selectedPeekable
      ? peekCost(1, egoIds(graph, selectedNode.id, 1).size)
      : 0;
  const selectedInPeek = selectedId ? peeks.some((p) => p.center === selectedId) : false;

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <GraphCanvas
        nodes={visNodes}
        links={visLinks}
        view={view}
        meId={dataset.meId}
        selectedId={selectedId}
        recIds={recIds}
        directIds={directIds}
        highlightNodes={highlightNodes}
        highlightLinks={highlightLinks}
        communityByNode={view === "circles" ? communities.byNode : null}
        communityInfos={view === "circles" && circleFilter == null ? communities.infos : null}
        frontierIds={frontierIds}
        onSelect={handleSelect}
        onFocus={(id) => setFocus(id)}
        apiRef={apiRef}
      />

      <TopBar
        allNodes={dataset.nodes}
        wallet={ensureWallet(dataset)}
        onJump={handleJump}
        onCreatePost={handleCreatePost}
        onBuyTokens={handleBuyTokens}
        pending={pending}
      />

      {/* Left side (#36 dual view): pill row on top — minimal Lens toggle (+ Feed
          reopen when closed) — with the feed list as the default companion below.
          The full Lens panel overlays on demand. */}
      {view !== "write" && (
        <div className="rise fixed left-4 top-[64px] z-40 hidden items-center gap-1.5 md:flex">
          <button
            onClick={() => setLensOpen((v) => !v)}
            aria-expanded={lensOpen}
            title="Lens — filter which node types the graph shows"
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium backdrop-blur-md transition"
            style={
              lensOpen
                ? { borderColor: "rgba(255,217,122,0.5)", background: "rgba(255,217,122,0.1)", color: "#ffd97a" }
                : { borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-dim)" }
            }
          >
            <SlidersHorizontal size={12} /> Lens
            {hiddenTypes.length > 0 && (
              <span className="rounded-full bg-[rgba(255,140,90,0.2)] px-1.5 text-[10px] font-bold text-[#ff8c5a]">{hiddenTypes.length}</span>
            )}
          </button>
          {!feedOpen && (
            <button
              onClick={() => setFeedOpen(true)}
              title="Recommendations from people you listen to — synced with the graph"
              className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1 text-[11.5px] font-medium text-[var(--color-dim)] backdrop-blur-md transition hover:text-ink"
            >
              <Radio size={12} /> Feed
            </button>
          )}
        </div>
      )}
      {view !== "write" && lensOpen && (
        <LeftRail
          counts={typeCounts}
          communities={communities.infos.filter((i) => i.size >= 3)}
          mode={mode}
          onSwitchMode={() => switchMode(mode === "mock" ? "api" : "mock")}
          onReset={() => {
            resetAll();
            setTimeout(() => apiRef.current?.fit(), 120);
          }}
        />
      )}
      {view !== "write" && feedOpen && !lensOpen && (
        <FeedPanel
          selected={selectedNode ? { id: selectedNode.id, label: selectedNode.label } : null}
          onJump={handleJump}
          onMatch={setFeedMatch}
          onClearSelection={() => select(null)}
          onClose={() => {
            setFeedOpen(false);
            setFeedMatch(null);
          }}
        />
      )}

      {view !== "write" && <LayerToggle layers={layers} onToggle={toggleLayer} />}

      <Inspector
        node={selectedNode}
        rec={selectedId ? recsById.get(selectedId) : undefined}
        maxRecScore={maxRecScore}
        graph={graph}
        nodeById={nodeById}
        meId={dataset.meId}
        entityLinks={selectedEntityLinks}
        promotionThreshold={ENTITY_LINK_PROMOTION_THRESHOLD}
        linkPickActive={!!linkPickFrom}
        peekable={selectedPeekable}
        peekCost={selectedPeekCost}
        peeked={selectedInPeek}
        onPeek={handlePeek}
        connected={selectedId ? connectedToMe(selectedId) : false}
        pending={pending}
        onConnect={handleConnect}
        onAcceptRec={handleAcceptRec}
        onDismissRec={handleDismissRec}
        onJump={handleJump}
        onFocus={(id) => setFocus(id)}
        onTrace={(id) => tracePathTo(dataset.meId, id)}
        onClose={() => select(null)}
        onStartEntityLink={(id) => {
          setLinkPickFrom(id);
          setLinkPickTarget(null);
        }}
        onRemoveEntityLink={handleRemoveEntityLink}
      />

      {/* Unified composer (#29) + private workspace (#31) — the right-side creation zone. */}
      {view !== "write" && <Composer nodes={dataset.nodes} />}

      <PlaceModalHost />

      {linkFromNode && view !== "write" && (
        <EntityLinkPicker
          from={linkFromNode}
          to={linkToNode}
          pending={pending}
          onCancel={() => {
            setLinkPickFrom(null);
            setLinkPickTarget(null);
          }}
          onPick={(preset) => {
            if (!linkPickTarget) return;
            handleAddEntityLink(
              linkFromNode.id,
              linkPickTarget,
              preset.type,
              preset.label,
            );
          }}
        />
      )}

      {notice && (
        <div className="pointer-events-none fixed bottom-20 right-4 z-40 max-w-[300px]">
          <div className="panel rise px-3.5 py-2.5 text-[12.5px] text-ink">{notice}</div>
        </div>
      )}

      {view === "write" && (
        <ThoughtComposer
          mode={mode}
          pending={pending}
          onExtract={handleExtract}
          onWeave={handleWeave}
          onExplore={handleExploreThought}
          onClose={() => setView("universe")}
        />
      )}

      <HintBar pathNodes={pathNodes} pathMissing={pathMissing} />
    </main>
  );
}
