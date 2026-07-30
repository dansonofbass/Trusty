"use client";

import { useMemo } from "react";
import { visibleIds } from "@constellation/graph-core";
import { useUI } from "@/lib/store";
import { useGraphData } from "./GraphDataProvider";

/**
 * The bounded galaxy (universeIds) and its frontier — extracted from the old
 * GraphExplorer so the Inspector's peek affordances work on ANY route, not
 * just /graph. Pure derivation over the shared graph + store state.
 */
export function useGalaxy(): { universeIds: Set<string>; frontierIds: Set<string> } {
  const { graph, dataset, follows, recIds } = useGraphData();
  const peeks = useUI((s) => s.peeks);
  const trustLayer = useUI((s) => s.layers.trust);

  // Your 2-hop ego ∪ each friend's IMMEDIATE neighborhood ∪ active peeks ∪
  // your recommendation frontier.
  const universeIds = useMemo(() => {
    const ids = visibleIds(graph, dataset.meId, { radius: 2, followRadius: 1, follows, peeks });
    for (const id of recIds) ids.add(id); // recs are your frontier — always shown
    // Providers you personally trust belong in your galaxy, but TRUSTS edges are
    // excluded from the visibility graph (toGraph), so a node you ONLY trust
    // would be an invisible island. Pull your direct trust targets in — gated by
    // the Trust layer, so its edge renders too (and toggling off removes both).
    if (trustLayer) {
      for (const l of dataset.links) {
        if (l.type !== "TRUSTS") continue;
        if ((typeof l.source === "string" ? l.source : l.source.id) === dataset.meId) {
          ids.add(typeof l.target === "string" ? l.target : l.target.id);
        }
      }
    }
    // Co-membership is unconditional visibility: if you're IN a squad (or a
    // startup), you see EVERYONE in it — the container is the trust surface,
    // not something to earn hop-by-hop.
    const end = (v: string | { id: string }) => (typeof v === "string" ? v : v.id);
    const myContainers = new Set(
      dataset.links
        .filter((l) => l.type === "MEMBER_OF" && end(l.source) === dataset.meId)
        .map((l) => end(l.target)),
    );
    if (myContainers.size) {
      for (const l of dataset.links) {
        if (l.type !== "MEMBER_OF") continue;
        const t = end(l.target);
        if (myContainers.has(t)) {
          ids.add(t);
          ids.add(end(l.source));
        }
      }
    }
    return ids;
  }, [graph, dataset.meId, dataset.links, follows, peeks, recIds, trustLayer]);

  // Visible nodes that still have neighbors beyond the bound — the edge of the
  // known, where a peek reveals what's past it.
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

  return { universeIds, frontierIds };
}
