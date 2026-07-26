"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeCommunities,
  egoIds,
  shortestPath,
  type GLink,
  type GNode,
} from "@constellation/graph-core";
import { switchMode } from "@/lib/dataSource";
import { communityColor } from "@/lib/palette";
import { useUI, type ViewId } from "@/lib/store";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useGalaxy } from "@/lib/graph/useGalaxy";
import GraphCanvas, { type CanvasApi } from "@/components/GraphCanvas";
import LeftRail from "@/components/LeftRail";
import LayerToggle from "@/components/LayerToggle";
import HintBar from "@/components/HintBar";
import EntityLinkPicker from "@/components/EntityLinkPicker";
import { Orbit, Route, SlidersHorizontal, Sparkles, Users } from "lucide-react";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/** The graph view toolbar — Universe · Circles · Path · Recs (the old
 *  graph-"discover" ghost-rec view; nav Discover is now the feed). */
const VIEW_TABS: { id: ViewId; label: string; icon: React.ElementType; title: string }[] = [
  { id: "universe", label: "Universe", icon: Orbit, title: "Your bounded galaxy" },
  { id: "circles", label: "Circles", icon: Users, title: "Color and isolate your communities" },
  { id: "path", label: "Path", icon: Route, title: "Trace the path between two nodes" },
  { id: "discover", label: "Recs", icon: Sparkles, title: "Ghost edges to things your network recommends" },
];

/**
 * The full graph as a center view (/graph) — the old GraphExplorer minus
 * TopBar / ActionDock / Composer / Inspector / FeedPanel / TrustSearch, which
 * now live elsewhere in the workspace shell. Dataset + mutations come from
 * GraphDataProvider; this component owns only the per-view derivations and
 * the canvas overlays (Lens, Layers, HintBar, entity-link picker).
 */
export default function GraphView() {
  const {
    dataset,
    graph,
    viewerLinks,
    nodeById,
    recsById,
    recIds,
    directIds,
    typeCounts,
    mode,
    pending,
    handleAddEntityLink,
  } = useGraphData();
  const { universeIds, frontierIds } = useGalaxy();

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
  const resetAll = useUI((s) => s.resetAll);
  const linkPickFrom = useUI((s) => s.linkPickFrom);
  const setLinkPickFrom = useUI((s) => s.setLinkPickFrom);
  const graphCenterRequest = useUI((s) => s.graphCenterRequest);
  const clearGraphCenter = useUI((s) => s.clearGraphCenter);

  const [lensOpen, setLensOpen] = useState(false);
  const [linkPickTarget, setLinkPickTarget] = useState<string | null>(null);
  const apiRef = useRef<CanvasApi | null>(null);

  // The entity-link flow clears linkPickFrom in the provider on success —
  // follow with the local target.
  useEffect(() => {
    if (!linkPickFrom) setLinkPickTarget(null);
  }, [linkPickFrom]);

  /* ------------------------------------------------------------ */
  /* Per-view world model                                           */
  /* ------------------------------------------------------------ */

  const communities = useMemo(() => {
    if (dataset.nodes.length === 0) return { byNode: {}, infos: [] };
    const c = computeCommunities(graph, dataset.nodes, 7);
    c.infos.forEach((i) => (i.color = communityColor(i.id)));
    dataset.nodes.forEach((n) => (n.community = c.byNode[n.id]));
    return c;
  }, [graph, dataset]);

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
      // universe, recs (discover), circles-overview, path-picking: your galaxy.
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

    return { highlightNodes, highlightLinks, pathNodes, pathMissing };
  }, [view, pathPick, selectedId, graph, recsById, dataset.meId, nodeById, visLinks, linkKey, trustOverlay]);

  // Trust search → graph animation: frame the top result when results land, and
  // fly to whichever result the user hovers in a panel.
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

  const handleJump = useCallback(
    (id: string) => {
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
        // Out of your galaxy: focus its own neighborhood so it actually RENDERS
        // on the canvas, and open the Inspector. setFocus also selects it.
        setFocus(id);
        setTimeout(() => apiRef.current?.centerOn(id), 240);
      }
    },
    [nodeById, universeIds, renderedIds, hiddenTypes, toggleType, focusId, setFocus, select],
  );

  // Cross-route camera contract: chat "show on graph", Inspector jumps from
  // other views, AddEntity, palette — all land here and get centered.
  useEffect(() => {
    if (!graphCenterRequest) return;
    if (!nodeById.has(graphCenterRequest)) return; // wait for the dataset to catch up
    handleJump(graphCenterRequest);
    clearGraphCenter();
  }, [graphCenterRequest, nodeById, handleJump, clearGraphCenter]);

  // Esc walks back: overlay panel → focus → link-pick → selection → path picks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const s = useUI.getState();
      if (s.rightPanel) s.setRightPanel(null); // overlay workspace first
      else if (s.focusId) s.setFocus(null);
      else if (s.linkPickFrom) {
        s.setLinkPickFrom(null);
        setLinkPickTarget(null);
      } else if (s.selectedId) s.select(null);
      else if (s.pathPick.length) s.clearPath();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const linkFromNode = linkPickFrom ? nodeById.get(linkPickFrom) ?? null : null;
  const linkToNode = linkPickTarget ? nodeById.get(linkPickTarget) ?? null : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
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

      {/* View toolbar — Universe · Circles · Path · Recs */}
      <div className="rise absolute left-4 top-4 z-40 hidden items-center gap-1.5 md:flex">
        <nav className="panel flex items-center gap-1 rounded-full px-1.5 py-1" aria-label="Graph views">
          {VIEW_TABS.map((t) => (
            <button key={t.id} className="tab" data-active={view === t.id} title={t.title}
              onClick={() => setView(view === t.id && t.id !== "universe" ? "universe" : t.id)}>
              <t.icon size={14} strokeWidth={2.2} />
              {t.label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => setLensOpen((v) => !v)}
          aria-expanded={lensOpen}
          title="Lens — filter which node types the graph shows"
          className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium backdrop-blur-md transition"
          style={
            lensOpen
              ? { borderColor: "rgba(255,140,90,0.5)", background: "rgba(255,140,90,0.1)", color: "#ff8c5a" }
              : { borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-dim)" }
          }
        >
          <SlidersHorizontal size={12} /> Lens
          {hiddenTypes.length > 0 && (
            <span className="rounded-full bg-[rgba(255,140,90,0.2)] px-1.5 text-[10px] font-bold text-[#ff8c5a]">{hiddenTypes.length}</span>
          )}
        </button>
      </div>

      {lensOpen && (
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

      <LayerToggle layers={layers} onToggle={toggleLayer} />

      {linkFromNode && (
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
            handleAddEntityLink(linkFromNode.id, linkPickTarget, preset.type, preset.label);
          }}
        />
      )}

      <HintBar pathNodes={pathNodes} pathMissing={pathMissing} />
    </div>
  );
}
