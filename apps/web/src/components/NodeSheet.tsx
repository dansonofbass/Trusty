"use client";

import { X } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { entityTypeById, topicForEntityType } from "@constellation/graph-core";
import { NODE_TYPE_LABEL } from "@constellation/graph-core";
import { NODE_COLOR, NODE_GLYPH, GOLD, TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { useUI } from "@/lib/store";
import SourceLinks from "./SourceLinks";
import PlaceDetail from "./PlaceDetail";
import ListenButton from "./ListenButton";
import RecommendButton from "./RecommendButton";

/**
 * Mobile node details — a bottom sheet (the phone-native answer to the desktop
 * Inspector side panel). Slides up when a node is tapped in the graph tab; shows
 * who/what it is, typed entity properties, sources, and the two actions that
 * matter on a phone: add a person/thing to your sky, or trust a provider.
 */

const has = (v: unknown) => v !== undefined && v !== null && v !== "";

export default function NodeSheet({
  node,
  connectedCount,
  connected,
  trusted,
  busy,
  onClose,
  onAddToSky,
  onTrust,
}: {
  node: GNode | null;
  connectedCount: number;
  connected: boolean;
  trusted: boolean;
  busy: boolean;
  onClose: () => void;
  onAddToSky: (id: string) => void;
  onTrust: (id: string, topic: string) => void;
}) {
  const open = !!node;
  const def = node?.entityType ? entityTypeById(node.entityType) : undefined;
  const props = node?.properties ?? {};
  const rows = node
    ? def
      ? def.fields.filter((f) => has(props[f.key])).map((f) => ({ label: f.label, unit: f.unit, value: props[f.key] }))
      : Object.entries(props).filter(([, v]) => has(v)).map(([k, v]) => ({ label: k, unit: undefined, value: v }))
    : [];
  const topic = node?.entityType ? topicForEntityType(node.entityType) : undefined;
  const isMe = node?.isMe;
  const canTrust = !!topic && !isMe;
  const canBefriend = !!node && !isMe && !canTrust; // people/content you can pull into your sky
  const isPlace = node?.entityType === "restaurant" || node?.entityType === "cafe";
  const select = useUI((s) => s.select);

  return (
    <>
      {/* scrim */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden
      />
      {/* sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-line bg-nebula/95 backdrop-blur-xl transition-transform duration-300 ease-out"
        style={{
          transform: open ? "translateY(0)" : "translateY(110%)",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
        role="dialog"
        aria-hidden={!open}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line" aria-hidden />

        {node && (
          <div className="max-h-[70dvh] overflow-y-auto px-5 pb-2 pt-3 scroll-quiet">
            {/* header */}
            <div className="flex items-start gap-3">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[18px] font-semibold"
                style={{
                  background: withAlpha(NODE_COLOR[node.type], 0.16),
                  border: `1px solid ${withAlpha(NODE_COLOR[node.type], 0.45)}`,
                  color: NODE_COLOR[node.type],
                }}
              >
                {node.type === "person"
                  ? isMe
                    ? "✦"
                    : node.label[0]?.toUpperCase()
                  : NODE_GLYPH[node.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: NODE_COLOR[node.type] }}>
                  {isMe ? "You" : def?.label ?? NODE_TYPE_LABEL[node.type]}
                </div>
                <h2 className="mt-0.5 break-words text-[17px] font-semibold leading-snug text-ink">{node.label}</h2>
                {node.sub && <p className="mt-0.5 text-[12.5px] text-dim">{node.sub}</p>}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {node.sources && node.sources.length > 0 && (
              <div className="mt-3">
                <SourceLinks sources={node.sources} />
              </div>
            )}

            {/* Restaurants/cafes get the full trust-native detail panel. */}
            {isPlace ? (
              <div className="mt-4">
                <PlaceDetail node={node} onJump={(id) => select(id)} />
              </div>
            ) : (
              <>
                {rows.length > 0 && (
                  <dl className="mt-4 grid grid-cols-2 gap-2">
                    {rows.map((r) => (
                      <div key={r.label} className="rounded-xl border border-line bg-space/40 px-3 py-2">
                        <dt className="text-[10.5px] uppercase tracking-wider text-faint">{r.label}</dt>
                        <dd className="mt-0.5 text-[13px] text-ink">
                          {Array.isArray(r.value) ? r.value.join(", ") : String(r.value)}
                          {r.unit ? ` ${r.unit}` : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <p className="mt-4 text-[12px] text-faint">
                  {connectedCount > 0
                    ? `Connected to ${connectedCount} ${connectedCount === 1 ? "thing" : "things"} in your galaxy`
                    : "Not yet linked into your galaxy"}
                </p>

                {/* actions */}
                <div className="mt-4 flex gap-2">
              {canTrust &&
                (trusted ? (
                  <span className="flex-1 rounded-xl border py-3 text-center text-[14px] font-semibold" style={{ borderColor: withAlpha(TRUST_ACCENT, 0.5), color: TRUST_ACCENT }}>
                    You trust them ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onTrust(node.id, topic!)}
                    className="flex-1 rounded-xl py-3 text-center text-[14px] font-bold text-space disabled:opacity-60"
                    style={{ background: TRUST_ACCENT, fontFamily: "var(--font-display)" }}
                  >
                    ✦ Trust on {topic!.replace(/_/g, " ")}
                  </button>
                ))}

              {canBefriend &&
                (connected ? (
                  <span className="flex-1 rounded-xl border border-line py-3 text-center text-[14px] font-semibold text-dim">
                    In your sky ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAddToSky(node.id)}
                    className="flex-1 rounded-xl py-3 text-center text-[14px] font-bold text-space disabled:opacity-60"
                    style={{ background: GOLD, fontFamily: "var(--font-display)" }}
                  >
                    ＋ Add to my sky
                  </button>
                ))}
                </div>

                {/* Full feature parity with the desktop Inspector: the merged
                    Recommend wizard (modal) + Listen on person nodes. */}
                {!isMe && (node.type === "person" || node.type === "location") && (
                  <div className="mt-3">
                    <RecommendButton targetId={node.id} targetLabel={node.label} nodeType={node.type} />
                  </div>
                )}
                {!isMe && node.type === "person" && (
                  <div className="mt-2">
                    <ListenButton targetId={node.id} targetLabel={node.label} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
