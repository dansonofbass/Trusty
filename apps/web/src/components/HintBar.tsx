"use client";

import { X } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { NODE_COLOR } from "@/lib/palette";
import { useUI } from "@/lib/store";
import { useT, type TranslationKey } from "@/lib/i18n";

const HINTS: Record<string, TranslationKey> = {
  universe: "graph.hintUniverse",
  circles: "graph.hintCircles",
  discover: "graph.hintDiscover",
  path: "graph.hintPath",
};

export default function HintBar({
  pathNodes,
  pathMissing,
}: {
  pathNodes: GNode[] | null;
  pathMissing: boolean;
}) {
  const t = useT();
  const view = useUI((s) => s.view);
  const focusId = useUI((s) => s.focusId);
  const pathPick = useUI((s) => s.pathPick);
  const clearPath = useUI((s) => s.clearPath);
  const setFocus = useUI((s) => s.setFocus);

  const showPathStrip = view === "path" && (pathPick.length > 0 || pathNodes);

  return (
    // bottom-[84px]: clears the ActionDock, which owns the bottom-center band.
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="flex max-w-3xl flex-col items-center gap-2">
        {focusId && (
          <button
            onClick={() => setFocus(null)}
            className="btn pointer-events-auto"
            style={{ animationDelay: "0s" }}
          >
            <X size={12} />
            {t("graph.exitFocus")}
          </button>
        )}

        {showPathStrip ? (
          <div className="panel pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 px-4 py-2.5">
            {pathNodes && pathNodes.length > 0 ? (
              <>
                <span className="eyebrow">{t("graph.pathHops", { count: pathNodes.length - 1 })}</span>
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
              <span className="text-[12.5px] text-[var(--color-dim)]">{t("graph.noPath")}</span>
            ) : (
              <span className="text-[12.5px] text-[var(--color-dim)]">
                {t(pathPick.length === 1 ? "graph.firstNodeLocked" : HINTS.path)}
              </span>
            )}
            {(pathPick.length > 0 || pathNodes) && (
              <button className="btn ms-1" onClick={clearPath}>
                {t("common.clear")}
              </button>
            )}
          </div>
        ) : (
          <div className="panel pointer-events-auto px-4 py-2 text-[12px] text-[var(--color-dim)]">
            {HINTS[view] ? t(HINTS[view]) : null}
          </div>
        )}
      </div>
    </div>
  );
}
