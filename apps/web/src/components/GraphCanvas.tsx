"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide, forceX, forceY } from "d3-force";
import type { CommunityInfo, GLink, GNode } from "@constellation/graph-core";
import {
  EDGE_BASE,
  GOLD,
  ME_CORE,
  NODE_COLOR,
  NODE_GLYPH,
  USER_ENTITY_LINK_COLOR,
  communityColor,
  withAlpha,
} from "@/lib/palette";
import type { ViewId } from "@/lib/store";

export interface CanvasApi {
  centerOn: (id: string) => void;
  fit: () => void;
}

interface Props {
  nodes: GNode[];
  links: GLink[];
  view: ViewId;
  meId: string;
  selectedId: string | null;
  recIds: Set<string>;
  directIds: Set<string>;
  highlightNodes: Set<string> | null;
  highlightLinks: Set<string> | null;
  communityByNode: Record<string, number> | null;
  communityInfos: CommunityInfo[] | null;
  /** Visible nodes with neighbors beyond your galaxy — the peekable edge. */
  frontierIds: Set<string>;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  apiRef: React.MutableRefObject<CanvasApi | null>;
}

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const idPhase = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * Math.PI * 2;
};

export default function GraphCanvas({
  nodes,
  links,
  view,
  meId,
  selectedId,
  recIds,
  directIds,
  highlightNodes,
  highlightLinks,
  communityByNode,
  communityInfos,
  frontierIds,
  onSelect,
  onFocus,
  apiRef,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastClick = useRef<{ id: string; t: number } | null>(null);
  const didFirstFit = useRef(false);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Track container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const radiusOf = useCallback((n: GNode) => {
    if (n.isMe) return 9;
    return Math.max(2.4, Math.sqrt(n.val ?? 4) * 1.7);
  }, []);

  const baseColorOf = useCallback(
    (n: GNode) => {
      if (view === "circles" && communityByNode) {
        const c = communityByNode[n.id];
        if (c != null) return communityColor(c);
      }
      return NODE_COLOR[n.type];
    },
    [view, communityByNode],
  );

  /* ---------------------------------------------------------------- */
  /* Painting                                                          */
  /* ---------------------------------------------------------------- */

  const paintNode = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GNode & { x: number; y: number };
      if (n.x == null || n.y == null) return;
      const r = radiusOf(n);
      const isMe = !!n.isMe;
      const isSelected = n.id === selectedId;
      const isHovered = n.id === hoverId;
      const isRec = (view === "discover" || view === "universe") && recIds.has(n.id);

      let alpha = 1;
      if (highlightNodes) {
        alpha = highlightNodes.has(n.id) ? 1 : 0.1;
      } else if (view === "discover") {
        alpha = isRec || isMe ? 1 : 0.38;
      }
      if (isHovered) alpha = Math.max(alpha, 0.85);

      const color = isMe ? ME_CORE : baseColorOf(n);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = isMe ? GOLD : color;
      ctx.shadowBlur = isMe ? 26 : isSelected || isHovered ? 16 : 9;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Me: permanent gold halo
      if (isMe) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.2, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(GOLD, 0.9);
        ctx.lineWidth = 1.6 / globalScale;
        ctx.stroke();
      }

      // Selection / hover rings
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.7 / globalScale;
        ctx.stroke();
      } else if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.3 / globalScale;
        ctx.stroke();
      }

      // Recommendation pulse — the frontier of your universe
      if (isRec) {
        const t = reducedMotion ? 0 : performance.now();
        const phase = idPhase(n.id);
        const pr = r + 3.4 + (reducedMotion ? 0 : Math.sin(t / 430 + phase) * 1.5);
        const pa = reducedMotion ? 0.8 : 0.55 + 0.35 * Math.sin(t / 430 + phase);
        ctx.beginPath();
        ctx.setLineDash([2.6, 2.2]);
        ctx.arc(n.x, n.y, pr, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(GOLD, Math.max(0.25, pa));
        ctx.lineWidth = 1.4 / globalScale;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Frontier ring — the edge of the known: this node has neighbors beyond
      // your galaxy. A static cool-indigo dash, distinct from the gold rec pulse.
      const isFrontier = view === "universe" && !isMe && !isRec && frontierIds.has(n.id);
      if (isFrontier) {
        ctx.beginPath();
        ctx.setLineDash([1.4, 2.4]);
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(124,150,255,0.5)";
        ctx.lineWidth = 1.1 / globalScale;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Glyph (semantic zoom: only when readable)
      if (globalScale > 1.55 || r > 6.4) {
        const glyph = n.type === "person" ? (isMe ? "✦" : (n.label[0] ?? "").toUpperCase()) : NODE_GLYPH[n.type];
        if (glyph) {
          ctx.font = `600 ${Math.max(r * 1.02, 2.6)}px "Spline Sans", Vazirmatn, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(7,10,24,0.88)";
          ctx.fillText(glyph, n.x, n.y + r * 0.04);
        }
      }

      // Label
      const showLabel =
        isMe ||
        isSelected ||
        isHovered ||
        globalScale > 2.2 ||
        (n.type === "person" && globalScale > 1.45);
      if (showLabel) {
        const fontPx = Math.min(13 / globalScale, 13);
        ctx.font = isMe
          ? `700 ${fontPx}px Syne, "Spline Sans", Vazirmatn, sans-serif`
          : `500 ${fontPx}px "Spline Sans", Vazirmatn, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(2,4,14,0.95)";
        ctx.shadowBlur = 5 / globalScale;
        ctx.fillStyle = withAlpha(isMe ? "#ffffff" : "#e9edff", Math.min(1, alpha + 0.05));
        ctx.fillText(truncate(n.label, 26), n.x, n.y + r + 3.5 / globalScale + 2);
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    },
    [radiusOf, baseColorOf, selectedId, hoverId, view, recIds, frontierIds, highlightNodes, reducedMotion],
  );

  const paintPointerArea = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as GNode & { x: number; y: number };
      ctx.beginPath();
      ctx.arc(n.x, n.y, radiusOf(n) + 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [radiusOf],
  );

  /* ---------------------------------------------------------------- */
  /* Link styling                                                      */
  /* ---------------------------------------------------------------- */

  const linkColor = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => {
      const link = l as GLink;
      if (highlightLinks?.has(link.id)) return withAlpha(GOLD, 0.95);
      if (highlightNodes) {
        const s = endId(link.source);
        const t = endId(link.target);
        if (highlightNodes.has(s) && highlightNodes.has(t)) {
          return link.type === "FRIENDS_WITH"
            ? "rgba(124,150,255,0.75)"
            : "rgba(175,190,240,0.5)";
        }
        return "rgba(140,160,220,0.035)";
      }
      if (view === "discover" && link.type !== "RECOMMENDED")
        return "rgba(140,160,220,0.06)";
      if (
        link.scope === "user" &&
        (link.type === "SAME_AS" || link.type === "RELATES_TO")
      ) {
        return USER_ENTITY_LINK_COLOR;
      }
      return EDGE_BASE[link.type]?.color ?? "rgba(140,160,220,0.2)";
    },
    [highlightLinks, highlightNodes, view],
  );

  const linkWidth = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => {
      const link = l as GLink;
      if (highlightLinks?.has(link.id)) return 2.4;
      if (highlightNodes) {
        const s = endId(link.source);
        const t = endId(link.target);
        if (highlightNodes.has(s) && highlightNodes.has(t))
          return (EDGE_BASE[link.type]?.width ?? 0.8) * 1.5;
      }
      return EDGE_BASE[link.type]?.width ?? 0.8;
    },
    [highlightLinks, highlightNodes],
  );

  /* ---------------------------------------------------------------- */
  /* Forces + camera                                                   */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-95);
    fg.d3Force("link")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.distance((l: any) =>
        l.type === "FRIENDS_WITH" ? 46 : l.type === "RECOMMENDED" ? 78 : 30,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .strength((l: any) =>
        l.type === "FRIENDS_WITH" ? 0.5 : l.type === "RECOMMENDED" ? 0.02 : 0.32,
      );
    fg.d3Force(
      "collide",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceCollide((n: any) => radiusOf(n as GNode) + 3).iterations(2),
    );
  }, [graphData, radiusOf]);

  /* Concentric cosmology --------------------------------------------- */
  /* Distance from You = relationship distance. You are the origin.      */
  /*   • inner sky   — things you're directly connected to: NEAR band    */
  /*   • outer world — everything else (friends-of-friends, their        */
  /*     interests you don't share): pushed FAR out                       */
  /*   • frontier    — gold recommendations: a distinct ring beyond       */
  /* Discover INVERTS it: the frontier is pulled close while your known   */
  /* sky drifts to the rim — the posture of going out to find things.     */
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const horizonOn = view === "universe" || view === "discover";
    if (!horizonOn) {
      fg.d3Force("ringR", null);
      fg.d3Force("skyX", null);
      fg.d3Force("skyY", null);
      fg.d3ReheatSimulation();
      return;
    }

    const inverted = view === "discover";
    // target orbit radius for each node
    const radiusFor = (n: GNode): number => {
      if (n.isMe) return 0;
      const frontier = recIds.has(n.id);
      const inner = directIds.has(n.id);
      if (frontier) return inverted ? 150 : 760;
      if (inner) return inverted ? 700 : 230;
      return inverted ? 560 : 520; // the broad outer world
    };

    // Radial force: pull each node toward its orbit around the origin.
    const nodesArr = graphData.nodes as Array<GNode & { x?: number; y?: number; vx?: number; vy?: number }>;
    const ringStrength = 0.09;
    const radial = (alpha: number) => {
      for (const n of nodesArr) {
        if (n.isMe || n.x == null || n.y == null) continue;
        const d = Math.hypot(n.x, n.y) || 1e-3;
        const target = radiusFor(n);
        const k = ((target - d) / d) * ringStrength * alpha;
        n.vx! += n.x * k;
        n.vy! += n.y * k;
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (radial as any).initialize = () => {};
    fg.d3Force("ringR", radial);
    // keep You pinned near the visual center so "your sky" reads as home
    fg.d3Force(
      "skyX",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceX(0).strength((n: any) => ((n as GNode).isMe ? 0.5 : 0.004)),
    );
    fg.d3Force(
      "skyY",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceY(0).strength((n: any) => ((n as GNode).isMe ? 0.5 : 0.004)),
    );
    fg.d3ReheatSimulation();
  }, [view, recIds, directIds, graphData]);

  // Refit only where the layout is compact (circles/path). In the
  // concentric views we deliberately DON'T refit — refitting collapses
  // the near/far gulf into one flat blob, which is the whole point here.
  useEffect(() => {
    if (!didFirstFit.current) return;
    if (view === "universe" || view === "discover") return;
    const tm = setTimeout(
      () => fgRef.current?.zoomToFit(700, view === "circles" ? 70 : 90),
      550,
    );
    return () => clearTimeout(tm);
  }, [view, nodes.length, links.length]);

  // Expose imperative camera API to the shell.
  useEffect(() => {
    apiRef.current = {
      centerOn: (id: string) => {
        const fg = fgRef.current;
        const n = nodes.find((x) => x.id === id);
        if (!fg || !n || n.x == null || n.y == null) return;
        fg.centerAt(n.x, n.y, 650);
        fg.zoom(Math.max(2.7, fg.zoom()), 650);
      },
      fit: () => fgRef.current?.zoomToFit(700, 95),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, nodes]);

  /* ---------------------------------------------------------------- */
  /* Community labels (Circles view)                                   */
  /* ---------------------------------------------------------------- */

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const paintBefore = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (view !== "universe" && view !== "discover") return;
      const me = nodeById.get(meId);
      const ox = me?.x ?? 0;
      const oy = me?.y ?? 0;
      const inverted = view === "discover";
      // [radius, label] for the two reference bands; matches the force targets.
      const bands: Array<[number, string]> = inverted
        ? [
            [150, "frontier — pulled close"],
            [700, "your sky — drifting out"],
          ]
        : [
            [230, "your sky"],
            [760, "the outer world"],
          ];
      ctx.save();
      for (const [r, label] of bands) {
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(146,166,255,0.07)";
        ctx.lineWidth = 1 / globalScale;
        ctx.setLineDash([6 / globalScale, 8 / globalScale]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 ${10.5 / globalScale}px "Spline Sans Mono", Vazirmatn, monospace`;
        ctx.fillStyle = "rgba(146,166,255,0.28)";
        ctx.textAlign = "center";
        ctx.fillText(label.toUpperCase(), ox, oy - r - 6 / globalScale);
      }
      ctx.restore();
    },
    [view, nodeById, meId],
  );

  const paintAfter = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (view !== "circles" || !communityInfos) return;
      for (const info of communityInfos) {
        if (info.size < 5) continue;
        let cx = 0;
        let cy = 0;
        let k = 0;
        for (const id of info.memberIds) {
          const n = nodeById.get(id);
          if (n && n.x != null && n.y != null) {
            cx += n.x;
            cy += n.y;
            k++;
          }
        }
        if (k < 3) continue;
        cx /= k;
        cy /= k;
        ctx.save();
        ctx.font = `700 ${14 / globalScale}px Syne, "Spline Sans", Vazirmatn, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(2,4,14,0.9)";
        ctx.shadowBlur = 6 / globalScale;
        ctx.fillStyle = withAlpha(communityColor(info.id), 0.85);
        ctx.fillText(info.label.toUpperCase(), cx, cy);
        ctx.restore();
      }
    },
    [view, communityInfos, nodeById],
  );

  /* ---------------------------------------------------------------- */
  /* Interaction                                                       */
  /* ---------------------------------------------------------------- */

  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const id = (node as GNode).id;
      const now = Date.now();
      if (lastClick.current && lastClick.current.id === id && now - lastClick.current.t < 320) {
        lastClick.current = null;
        onFocus(id);
        return;
      }
      lastClick.current = { id, t: now };
      onSelect(id);
    },
    [onFocus, onSelect],
  );

  const handleHover = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const id = node ? (node as GNode).id : null;
      setHoverId(id);
      if (wrapRef.current) wrapRef.current.style.cursor = id ? "pointer" : "grab";
    },
    [],
  );

  return (
    <div ref={wrapRef} className="absolute inset-0 z-10">
      {size.w > 0 && (
        <ForceGraph2D
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={fgRef as any}
          width={size.w}
          height={size.h}
          graphData={graphData}
          nodeId="id"
          nodeLabel={() => ""}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          linkLineDash={(l: any) => {
            const link = l as GLink;
            if (link.type === "RECOMMENDED") return [4, 3];
            if (
              link.scope === "user" &&
              (link.type === "SAME_AS" || link.type === "RELATES_TO")
            ) {
              return [7, 5];
            }
            return null;
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          linkDirectionalParticles={(l: any) =>
            highlightLinks?.has((l as GLink).id) ? 2 : 0
          }
          linkDirectionalParticleWidth={2.6}
          linkDirectionalParticleColor={() => GOLD}
          linkDirectionalParticleSpeed={0.0065}
          autoPauseRedraw={false}
          warmupTicks={60}
          d3VelocityDecay={0.32}
          minZoom={0.2}
          maxZoom={12}
          onNodeClick={handleNodeClick}
          onNodeHover={handleHover}
          onBackgroundClick={() => onSelect(null)}
          onEngineStop={() => {
            if (!didFirstFit.current) {
              didFirstFit.current = true;
              // generous padding: show the whole cosmology — inner sky,
              // outer world, and frontier ring — at first paint.
              fgRef.current?.zoomToFit(900, 140);
            }
          }}
          onRenderFramePre={paintBefore}
          onRenderFramePost={paintAfter}
        />
      )}
    </div>
  );
}
