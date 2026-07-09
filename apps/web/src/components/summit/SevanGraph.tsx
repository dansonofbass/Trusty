"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dataset, GLink, GNode } from "@constellation/graph-core";
import GraphCanvas, { type CanvasApi } from "../GraphCanvas";
import { getWhoToMeet, SUMMIT_APP } from "@/lib/summitClient";
import type { OpenTarget } from "./SummitApp";
import { Loader2 } from "lucide-react";

/**
 * The Trusty Sevan event graph — the SAME force canvas, pulses and because-path
 * as Trusty (zero canvas changes), scoped to the summit App. Shared concept
 * nodes (mint) cluster people by technology/interest; your top matches render as
 * the familiar dashed-gold RECOMMENDED ghost edges. Tap → ProfileCard.
 */

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

export default function SevanGraph({ onOpen }: { onOpen: (t: OpenTarget) => void }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [matches, setMatches] = useState<Map<string, { pct: number; reasons: string[] }>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const apiRef = useRef<CanvasApi | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [g, recs] = await Promise.all([
        fetch(`/api/graph?app=${SUMMIT_APP}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        getWhoToMeet().catch(() => []),
      ]);
      if (!live) return;
      setData(g);
      setMatches(new Map(recs.map((r) => [r.nodeId, { pct: r.matchPct, reasons: r.reasons }])));
    })();
    return () => { live = false; };
  }, []);

  const meId = data?.meId ?? "";

  const derived = useMemo(() => {
    if (!data) return null;
    // Event-focused slice: summit entities + shared tag-concepts + me. Plain
    // social persons from the general galaxy stay out of this view.
    const keep = (n: GNode) => n.id === meId || !!n.entityType || n.id.startsWith("cn_t_");
    const visNodes = data.nodes.filter(keep);
    const vis = new Set(visNodes.map((n) => n.id));
    const visLinks: GLink[] = data.links.filter((l) => vis.has(endId(l.source)) && vis.has(endId(l.target)));
    // Top matches as the familiar dashed-gold RECOMMENDED ghost edges from You.
    const recIds = new Set<string>();
    for (const [id] of [...matches.entries()].slice(0, 8)) {
      if (!vis.has(id)) continue;
      recIds.add(id);
      visLinks.push({ id: `rec-${id}`, source: meId, target: id, type: "RECOMMENDED", weight: 1 });
    }
    const directIds = new Set<string>();
    for (const l of data.links) {
      if (l.type !== "SAVED" && l.type !== "FRIENDS_WITH" && l.type !== "MET_AT") continue;
      const s = endId(l.source), t = endId(l.target);
      if (s === meId) directIds.add(t);
      if (t === meId) directIds.add(s);
    }
    return { visNodes, visLinks, recIds, directIds };
  }, [data, matches, meId]);

  const EMPTY = useMemo(() => new Set<string>(), []);

  if (!data || !derived) {
    return (
      <div className="flex h-[60dvh] items-center justify-center text-dim">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-220px)] min-h-[320px] w-full overflow-hidden rounded-2xl border border-line">
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
        onSelect={(id) => {
          setSelectedId(id);
          if (!id) return;
          const node = data.nodes.find((n) => n.id === id);
          // Concepts anchor the clusters; entities open the profile card.
          if (node && node.entityType) onOpen({ node, match: matches.get(id) });
        }}
        onFocus={(id) => apiRef.current?.centerOn(id)}
        apiRef={apiRef}
      />
    </div>
  );
}
