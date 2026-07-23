"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  entityLinksForNode,
  egoIds,
  peekCost,
  ENTITY_LINK_PROMOTION_THRESHOLD,
} from "@constellation/graph-core";
import Inspector from "@/components/Inspector";
import { useUI } from "@/lib/store";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useGalaxy } from "@/lib/graph/useGalaxy";

/**
 * Mounts the Inspector (the contextual right panel, P1 content) above the
 * center-view swap so selecting a node works from ANY view. Jump/trace/focus
 * land on /graph via the graphCenterRequest camera contract.
 */
export default function InspectorHost() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    dataset,
    graph,
    nodeById,
    recsById,
    maxRecScore,
    pending,
    connectedToMe,
    handleConnect,
    handleAcceptRec,
    handleDismissRec,
    handlePeek,
    handleRemoveEntityLink,
  } = useGraphData();
  const { universeIds, frontierIds } = useGalaxy();

  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const setFocus = useUI((s) => s.setFocus);
  const tracePathTo = useUI((s) => s.tracePathTo);
  const linkPickFrom = useUI((s) => s.linkPickFrom);
  const setLinkPickFrom = useUI((s) => s.setLinkPickFrom);
  const peeks = useUI((s) => s.peeks);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);

  const onGraph = pathname === "/graph";
  const toGraphWith = (id: string) => {
    requestGraphCenter(id);
    if (!onGraph) router.push("/graph");
  };

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const selectedEntityLinks = selectedId
    ? entityLinksForNode(dataset, selectedId, dataset.meId)
    : [];

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
      onPeek={(id) => {
        handlePeek(id);
        if (!onGraph) router.push("/graph");
      }}
      connected={selectedId ? connectedToMe(selectedId) : false}
      pending={pending}
      onConnect={handleConnect}
      onAcceptRec={handleAcceptRec}
      onDismissRec={handleDismissRec}
      onJump={(id) => {
        select(id);
        toGraphWith(id);
      }}
      onFocus={(id) => {
        setFocus(id);
        toGraphWith(id);
      }}
      onTrace={(id) => {
        tracePathTo(dataset.meId, id);
        toGraphWith(id);
      }}
      onClose={() => select(null)}
      onStartEntityLink={(id) => {
        setLinkPickFrom(id);
        if (!onGraph) router.push("/graph"); // the second node is picked on the canvas
      }}
      onRemoveEntityLink={handleRemoveEntityLink}
    />
  );
}
