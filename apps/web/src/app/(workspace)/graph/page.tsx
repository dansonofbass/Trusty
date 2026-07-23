"use client";

import dynamic from "next/dynamic";

// react-force-graph paints straight to <canvas> and needs `window`.
const GraphView = dynamic(() => import("@/components/graph/GraphView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span
        className="pulse-dot text-[13px] font-bold tracking-[0.3em] text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        UNIVERSE
      </span>
    </div>
  ),
});

export default function GraphPage() {
  return <GraphView />;
}
