"use client";

import { X } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { NODE_COLOR } from "@/lib/palette";
import { useUI } from "@/lib/store";

const HINTS: Record<string, string> = {
  universe: "Your galaxy — friends and what's near them. Befriend to grow it, or spend ✦ to peek past the indigo frontier",
  circles: "Your galaxy, grouped into living circles — pick one in the legend to isolate it",
  discover: "Gold pulses are your frontier — click one to see exactly why it's recommended",
  path: "Click two nodes in your galaxy to reveal how they're connected",
};

export default function HintBar({
  pathNodes,
  pathMissing,
}: {
  pathNodes: GNode[] | null;
  pathMissing: boolean;
}) {
  const view = useUI((s) => s.view);
  const focusId = useUI((s) => s.focusId);
  const pathPick = useUI((s) => s.pathPick);
  const clearPath = useUI((s) => s.clearPath);
  const setFocus = useUI((s) => s.setFocus);

  const showPathStrip = view === "path" && (pathPick.length > 0 || pathNodes);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="flex max-w-3xl flex-col items-center gap-2">
        {focusId && (
          <button
            onClick={() => setFocus(null)}
            className="btn pointer-events-auto"
            style={{ animationDelay: "0s" }}
          >
            <X size={12} />
            Exit neighborhood focus
          </button>
        )}

        {showPathStrip ? (
          <div className="panel pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 px-4 py-2.5">
            {pathNodes && pathNodes.length > 0 ? (
              <>
                <span className="eyebrow">Path · {pathNodes.length - 1} hops</span>
                {pathNodes.map((n, i) => (
                  <span key={n.id} className="flex items-center gap-2">
                    <span className="chip cursor-default">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: NODE_COLOR[n.type] }}
                      />
                      <span className="max-w-[140px] truncate">{n.label}</span>
                    </span>
                    {i < pathNodes.length - 1 && (
                      <span className="text-[var(--color-gold)]">→</span>
                    )}
                  </span>
                ))}
              </>
            ) : pathMissing ? (
              <span className="text-[12.5px] text-[var(--color-dim)]">
                No path between these two with the current lens — try unhiding some node types.
              </span>
            ) : (
              <span className="text-[12.5px] text-[var(--color-dim)]">
                {pathPick.length === 1
                  ? "First node locked — now click a second node…"
                  : HINTS.path}
              </span>
            )}
            {(pathPick.length > 0 || pathNodes) && (
              <button className="btn ml-1" onClick={clearPath}>
                Clear
              </button>
            )}
          </div>
        ) : (
          <div className="panel pointer-events-auto px-4 py-2 text-[12px] text-[var(--color-dim)]">
            {HINTS[view]}
          </div>
        )}
      </div>
    </div>
  );
}
