"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toGraph, visibleIds, type Dataset, type GLink } from "@constellation/graph-core";
import { createClient } from "@/lib/dataSource";
import { addTrust } from "@/lib/trustClient";
import { useUI } from "@/lib/store";
import GraphCanvas, { type CanvasApi } from "./GraphCanvas";
import NodeSheet from "./NodeSheet";
import PlaceModalHost from "./PlaceModalHost";
import AddEntity from "./AddEntity";

/**
 * Mobile graph tab — the second half of the dual view. Loads the viewer's
 * dataset, bounds it to their galaxy (same visibility model as desktop, incl.
 * pulling in providers they trust), and renders the touch canvas. Tapping a node
 * selects it → the NodeSheet bottom sheet shows details + actions. The AddEntity
 * island is mounted here so "add a provider/place" is reachable on mobile too.
 */

const endId = (v: string | GLink["source"]): string => (typeof v === "string" ? v : v.id);

export default function MobileGraph() {
  const [data, setData] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(false);
  const graphNonce = useUI((s) => s.graphNonce);
  const layers = useUI((s) => s.layers);
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const apiRef = useRef<CanvasApi | null>(null);
  const clientRef = useRef(createClient("api"));

  useEffect(() => {
    let live = true;
    clientRef.current
      .load()
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [graphNonce]);

  const meId = data?.meId ?? "";
  const graph = useMemo(() => (data ? toGraph(data.nodes, data.links) : null), [data]);

  const derived = useMemo(() => {
    if (!data || !graph) return null;
    const follows = new Set<string>();
    const directIds = new Set<string>();
    for (const l of data.links) {
      if (l.type !== "FRIENDS_WITH") continue;
      const a = endId(l.source);
      const b = endId(l.target);
      if (a === meId) follows.add(b);
      if (b === meId) follows.add(a);
    }
    for (const l of data.links) {
      const a = endId(l.source);
      const b = endId(l.target);
      if (a === meId) directIds.add(b);
      if (b === meId) directIds.add(a);
    }
    const ids = visibleIds(graph, meId, { radius: 2, followRadius: 1, follows });
    // Providers you personally trust belong in your galaxy (trust edges are
    // excluded from the visibility graph) — mirror the desktop fix, layer-gated.
    if (layers.trust) {
      for (const l of data.links) {
        if (l.type === "TRUSTS" && endId(l.source) === meId) ids.add(endId(l.target));
      }
    }
    const recIds = new Set(data.recommendations.map((r) => r.nodeId));
    for (const id of recIds) ids.add(id);

    const visNodes = data.nodes.filter((n) => ids.has(n.id));
    const vis = new Set(visNodes.map((n) => n.id));
    const visLinks = data.links.filter(
      (l) =>
        vis.has(endId(l.source)) &&
        vis.has(endId(l.target)) &&
        (layers.trust || l.type !== "TRUSTS"),
    );
    return { visNodes, visLinks, recIds, directIds };
  }, [data, graph, meId, layers.trust]);

  const selectedNode = useMemo(
    () => (data && selectedId ? data.nodes.find((n) => n.id === selectedId) ?? null : null),
    [data, selectedId],
  );
  const connectedCount = selectedId && graph?.hasNode(selectedId) ? graph.degree(selectedId) : 0;
  const connected = !!selectedId && !!derived?.directIds.has(selectedId);
  const trusted =
    !!selectedId &&
    !!data?.links.some(
      (l) => l.type === "TRUSTS" && endId(l.source) === meId && endId(l.target) === selectedId,
    );

  const addToSky = async (id: string) => {
    setBusy(true);
    try {
      setData(await clientRef.current.addEdge(meId, id));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const trust = async (id: string, topic: string) => {
    setBusy(true);
    try {
      await addTrust({ to: id, scope: { topic }, confidence: 0.8 });
      setData(await clientRef.current.load());
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const EMPTY = useMemo(() => new Set<string>(), []);

  if (!data || !graph || !derived) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-dim">
        Loading your galaxy…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <GraphCanvas
        nodes={derived.visNodes}
        links={derived.visLinks}
        view="universe"
        meId={meId}
        selectedId={selectedId}
        recIds={derived.recIds}
        directIds={derived.directIds}
        highlightNodes={null}
        highlightLinks={null}
        communityByNode={null}
        communityInfos={null}
        frontierIds={EMPTY}
        onSelect={select}
        onFocus={(id) => apiRef.current?.centerOn(id)}
        apiRef={apiRef}
      />

      {/* add-provider island (its own FAB) */}
      <AddEntity />

      <NodeSheet
        node={selectedNode}
        connectedCount={connectedCount}
        connected={connected}
        trusted={trusted}
        busy={busy}
        onClose={() => select(null)}
        onAddToSky={addToSky}
        onTrust={trust}
      />

      <PlaceModalHost />
    </div>
  );
}
