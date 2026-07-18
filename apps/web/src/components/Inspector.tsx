"use client";

import { Fragment, useMemo } from "react";
import { Check, Crosshair, Eye, Link2, Plus, Route, Sparkles, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import type { UndirectedGraph } from "graphology";
import type { GLink, GNode, NodeType, Recommendation } from "@constellation/graph-core";
import {
  NODE_TYPE_LABEL,
  commonNeighborIds,
  entityLinkLabel,
  entityTypeById,
  isUserScopedLink,
} from "@constellation/graph-core";
import { ACCENT, NODE_COLOR, NODE_GLYPH, withAlpha } from "@/lib/palette";
import AnnotatedText from "./AnnotatedText";
import SourceLinks from "./SourceLinks";
import ListenButton from "./ListenButton";
import RecommendButton from "./RecommendButton";
import PlaceDetail from "./PlaceDetail";

/** Restaurant/cafe nodes get the full trust-native detail panel, not the generic entity grid. */
const isPlaceNode = (n: GNode | null): boolean =>
  n?.entityType === "restaurant" || n?.entityType === "cafe";

const GROUP_ORDER: NodeType[] = [
  "person",
  "concept",
  "thought",
  "book",
  "news",
  "music",
  "video",
  "social_account",
  "post",
  "movie",
  "financial_signal",
  "location",
];

/** Secondary footer action: icon-in-circle with a tiny label beneath. */
function IconAction({
  label,
  onClick,
  children,
  disabled,
  title,
  accentLabel,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
  /** Token costs render in the accent (they spend ✦). */
  accentLabel?: boolean;
}) {
  return (
    <div className="flex w-[52px] flex-col items-center gap-1">
      <button type="button" className="icon-btn" disabled={disabled} onClick={onClick} title={title ?? label}>
        {children}
      </button>
      <span
        className="whitespace-nowrap text-[9.5px]"
        style={{ color: accentLabel ? "var(--color-accent)" : "var(--color-faint)" }}
      >
        {label}
      </span>
    </div>
  );
}

function NodeChip({
  node,
  onClick,
}: {
  node: GNode;
  onClick: (id: string) => void;
}) {
  return (
    <button className="chip max-w-full" onClick={() => onClick(node.id)} title={node.label}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_COLOR[node.type] }} />
      <span className="truncate">{node.label}</span>
    </button>
  );
}

/** Ontology entity details — typed properties rendered from the type's schema. */
function EntityDetails({ node }: { node: GNode }) {
  const def = node.entityType ? entityTypeById(node.entityType) : undefined;
  const props = node.properties ?? {};
  const has = (v: unknown) =>
    v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  const entries = def
    ? def.fields.filter((f) => has(props[f.key])).map((f) => ({ label: f.label, unit: f.unit, value: props[f.key] }))
    : Object.entries(props).filter(([, v]) => has(v)).map(([k, v]) => ({ label: k, unit: undefined, value: v }));
  const fmt = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => String(x).replace(/_/g, " ")).join(", ")
      : typeof v === "boolean"
        ? v ? "Yes" : "No"
        : String(v).replace(/_/g, " ");

  return (
    <section className="card mb-3" style={{ borderColor: "var(--color-accent-line)", background: "rgba(255,140,90,0.04)" }}>
      <div className="eyebrow mb-2" style={{ color: "var(--color-accent)" }}>
        {def?.label ?? node.entityType}
      </div>
      {entries.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-faint)]">No details yet.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {entries.map((e, i) => (
            <Fragment key={i}>
              <dt className="text-[var(--color-faint)]">{e.label}</dt>
              <dd className="text-ink">
                {fmt(e.value)}
                {e.unit ? <span className="text-[var(--color-faint)]"> {e.unit}</span> : null}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

export default function Inspector({
  node,
  rec,
  maxRecScore,
  graph,
  nodeById,
  meId,
  connected,
  pending,
  onConnect,
  onAcceptRec,
  onDismissRec,
  onJump,
  onFocus,
  onTrace,
  onClose,
  entityLinks = [],
  promotionThreshold = 2,
  linkPickActive = false,
  peekable = false,
  peekCost = 0,
  peeked = false,
  onPeek,
  onStartEntityLink,
  onRemoveEntityLink,
}: {
  node: GNode | null;
  rec: Recommendation | undefined;
  maxRecScore: number;
  graph: UndirectedGraph;
  nodeById: Map<string, GNode>;
  meId: string;
  connected: boolean;
  pending: boolean;
  onConnect: (id: string) => void;
  onAcceptRec: (id: string) => void;
  onDismissRec: (id: string) => void;
  onJump: (id: string) => void;
  onFocus: (id: string) => void;
  onTrace: (id: string) => void;
  onClose: () => void;
  entityLinks?: GLink[];
  promotionThreshold?: number;
  linkPickActive?: boolean;
  /** This node sits beyond your galaxy (or on its frontier) — peekable. */
  peekable?: boolean;
  /** Token cost to peek at this node's region. */
  peekCost?: number;
  /** This node is already inside an active (ephemeral) peek. */
  peeked?: boolean;
  onPeek?: (id: string) => void;
  onStartEntityLink?: (id: string) => void;
  onRemoveEntityLink?: (linkId: string) => void;
}) {
  const neighborGroups = useMemo(() => {
    if (!node || !graph.hasNode(node.id)) return [];
    const byType = new Map<NodeType, GNode[]>();
    graph.forEachNeighbor(node.id, (id) => {
      const n = nodeById.get(id);
      if (!n) return;
      if (!byType.has(n.type)) byType.set(n.type, []);
      byType.get(n.type)!.push(n);
    });
    return GROUP_ORDER.filter((t) => byType.has(t)).map((t) => ({
      type: t,
      items: byType.get(t)!.sort((a, b) => (b.val ?? 0) - (a.val ?? 0)),
    }));
  }, [node, graph, nodeById]);

  const shared = useMemo(() => {
    if (!node || node.isMe || node.type !== "person") return [];
    return commonNeighborIds(graph, meId, node.id)
      .map((id) => nodeById.get(id))
      .filter((n): n is GNode => !!n)
      .sort((a, b) => (a.type === "person" ? -1 : 1) - (b.type === "person" ? -1 : 1));
  }, [node, graph, nodeById, meId]);

  // Hops from You — small capped BFS for the stat tile ("6+" beyond, "—" unreachable).
  const hops = useMemo(() => {
    if (!node || node.isMe || !graph.hasNode(node.id) || !graph.hasNode(meId)) return null;
    const MAX = 6;
    const seen = new Set<string>([meId]);
    let frontier = [meId];
    for (let d = 1; d <= MAX; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        let found = false;
        graph.forEachNeighbor(id, (nb) => {
          if (found || seen.has(nb)) return;
          if (nb === node.id) found = true;
          seen.add(nb);
          next.push(nb);
        });
        if (found) return String(d);
      }
      if (!next.length) break;
      frontier = next;
    }
    return frontier.length ? `${MAX}+` : "—";
  }, [node, graph, meId]);

  const degree = node && graph.hasNode(node.id) ? graph.degree(node.id) : 0;

  const stats: { label: string; value: string; accent?: boolean }[] = [];
  if (node) {
    stats.push({ label: "Links", value: String(degree) });
    if (shared.length > 0) stats.push({ label: "Shared", value: String(shared.length) });
    if (hops) stats.push({ label: "Hops from you", value: hops });
    if (rec) stats.push({ label: "Affinity", value: String(rec.score), accent: true });
  }

  const open = !!node;

  return (
    <aside
      className="fixed bottom-4 right-4 top-24 z-30 w-[340px] transition-transform duration-300 ease-out"
      style={{ transform: open ? "translateX(0)" : "translateX(calc(100% + 24px))" }}
      aria-hidden={!open}
    >
      {node && (
        <div className="panel flex h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-[var(--color-line)] p-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[18px] font-semibold"
              style={{
                background: withAlpha(NODE_COLOR[node.type], 0.16),
                border: `1px solid ${withAlpha(NODE_COLOR[node.type], 0.45)}`,
                color: NODE_COLOR[node.type],
              }}
            >
              {node.type === "person"
                ? node.isMe
                  ? "✦"
                  : node.label[0]?.toUpperCase()
                : NODE_GLYPH[node.type]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow" style={{ color: NODE_COLOR[node.type] }}>
                {node.isMe ? "You" : NODE_TYPE_LABEL[node.type]}
              </div>
              <h2
                className="mt-0.5 break-words text-[17px] font-bold leading-snug text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {node.label}
              </h2>
              {node.sub && (
                <p className="mt-0.5 text-[12px] text-[var(--color-dim)]">{node.sub}</p>
              )}
              {connected && !node.isMe && node.type === "person" && (
                <span
                  className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                >
                  <Check size={10} /> Friends
                </span>
              )}
              {node.sources && node.sources.length > 0 && (
                <SourceLinks sources={node.sources} />
              )}
            </div>
            <button
              aria-label="Close inspector"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--color-faint)] transition hover:bg-[var(--color-tint)] hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 scroll-quiet">
            {/* Stat tiles — the node at a glance. */}
            {stats.length >= 2 && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                {stats.slice(0, 4).map((s) => (
                  <div key={s.label} className="stat-tile">
                    <span className="stat-label">{s.label}</span>
                    <span className="stat-value" style={s.accent ? { color: "var(--color-accent)" } : undefined}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {isPlaceNode(node) ? (
              <div className="mb-4">
                <PlaceDetail node={node} onJump={onJump} />
              </div>
            ) : (
              node.entityType && <EntityDetails node={node} />
            )}
            {node.type === "thought" && node.body && (
              <section
                className="card mb-3"
                style={{
                  borderColor: withAlpha(NODE_COLOR.thought, 0.25),
                  background: withAlpha(NODE_COLOR.thought, 0.04),
                }}
              >
                <div className="eyebrow mb-2" style={{ color: NODE_COLOR.thought }}>
                  Your writing
                </div>
                {node.extraction?.entities?.length ? (
                  <AnnotatedText
                    text={node.body}
                    entities={node.extraction.entities}
                    compact
                    animate={false}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-dim)]">
                    {node.body}
                  </p>
                )}
                {node.extraction?.summary && (
                  <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11.5px] italic text-[var(--color-dim)]">
                    {node.extraction.summary}
                  </p>
                )}
              </section>
            )}

            {/* Entity links (local + global SAME_AS / RELATES_TO). Allowed for
                ideas/content and PUBLIC figures, but not social accounts. */}
            {(node.type !== "person" || node.figure) && (
              <section className="card mb-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="eyebrow">Entity links · {entityLinks.length}</div>
                  {onStartEntityLink && (
                    <button
                      type="button"
                      className={linkPickActive ? "btn-accent" : "btn"}
                      disabled={pending}
                      onClick={() => onStartEntityLink(node.id)}
                    >
                      <Link2 size={12} />
                      {linkPickActive ? "Pick target…" : "Link to…"}
                    </button>
                  )}
                </div>
                {entityLinks.length === 0 ? (
                  <p className="text-[11.5px] text-[var(--color-faint)]">
                    Connect this to another entity — same name in another language, or a semantic
                    relation. Local until others agree.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {entityLinks.map((link) => {
                      const otherId =
                        (typeof link.source === "string" ? link.source : link.source.id) ===
                        node.id
                          ? typeof link.target === "string"
                            ? link.target
                            : link.target.id
                          : typeof link.source === "string"
                            ? link.source
                            : link.source.id;
                      const other = nodeById.get(otherId);
                      const local = isUserScopedLink(link);
                      const supporters = link.supporters?.length ?? 0;
                      return (
                        <li
                          key={link.id}
                          className="rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => other && onJump(other.id)}
                            >
                              <div className="text-[11px] text-[var(--color-faint)]">
                                {link.type === "SAME_AS" ? "Same as" : "Relates"}
                                {local ? " · your link" : " · global"}
                              </div>
                              <div className="truncate text-[12.5px] font-medium text-ink">
                                {entityLinkLabel(link)}
                              </div>
                              {other && (
                                <div className="truncate text-[11px] text-[var(--color-dim)]">
                                  → {other.label}
                                </div>
                              )}
                            </button>
                            {local && onRemoveEntityLink && (
                              <button
                                type="button"
                                aria-label="Remove link"
                                className="rounded p-1 text-[var(--color-faint)] hover:text-[#ff9a90]"
                                disabled={pending}
                                onClick={() => onRemoveEntityLink(link.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                          {local && supporters > 0 && (
                            <div className="mt-2 text-[10px] text-[var(--color-faint)]">
                              {supporters}/{promotionThreshold} assertions toward global
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* Why this is here — explainable recommendation */}
            {rec && (
              <section
                className="card mb-3"
                style={{
                  background: withAlpha(ACCENT, 0.07),
                  borderColor: withAlpha(ACCENT, 0.3),
                }}
              >
                <div className="eyebrow mb-1.5 flex items-center gap-1" style={{ color: "var(--color-accent)" }}>
                  <Sparkles size={11} /> Why this is here
                </div>
                <p className="text-[12.5px] leading-relaxed text-ink">{rec.reason}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--color-faint)]">via</span>
                  {rec.via.map((id) => {
                    const v = nodeById.get(id);
                    return v ? <NodeChip key={id} node={v} onClick={onJump} /> : null;
                  })}
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[10.5px] text-[var(--color-faint)]">
                    <span>Affinity</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{rec.score}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--color-tint)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (rec.score / Math.max(1, maxRecScore)) * 100)}%`,
                        background: "var(--color-accent)",
                        boxShadow: `0 0 8px ${withAlpha(ACCENT, 0.8)}`,
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-accent flex-1"
                    disabled={pending}
                    onClick={() => onAcceptRec(node.id)}
                    title="The ghost edge becomes a real one"
                  >
                    <Sparkles size={13} />
                    Accept into your sky
                  </button>
                  <button
                    className="btn justify-center"
                    disabled={pending}
                    onClick={() => onDismissRec(node.id)}
                    title="Never show this again"
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            )}

            {/* Shared lens with a friend */}
            {shared.length > 0 && (
              <section className="card mb-3">
                <div className="eyebrow mb-2">Shared with you · {shared.length}</div>
                <div className="flex flex-wrap gap-1.5">
                  {shared.slice(0, 10).map((n) => (
                    <NodeChip key={n.id} node={n} onClick={onJump} />
                  ))}
                  {shared.length > 10 && (
                    <span className="chip cursor-default opacity-60">
                      +{shared.length - 10} more
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Connections grouped by type */}
            {neighborGroups.map((g) => (
              <section key={g.type} className="card mb-3">
                <div className="eyebrow mb-2 flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: NODE_COLOR[g.type] }}
                  />
                  {NODE_TYPE_LABEL[g.type]} · {g.items.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.slice(0, 12).map((n) => (
                    <NodeChip key={n.id} node={n} onClick={onJump} />
                  ))}
                  {g.items.length > 12 && (
                    <span className="chip cursor-default opacity-60">
                      +{g.items.length - 12} more
                    </span>
                  )}
                </div>
              </section>
            ))}

            {neighborGroups.length === 0 && (
              <p className="text-[12.5px] text-[var(--color-faint)]">
                A quiet corner of the sky — no visible connections with the current lens.
              </p>
            )}
          </div>

          {/* Actions — ONE solid primary + a compact secondary icon row. */}
          <div className="flex flex-col gap-2.5 border-t border-[var(--color-line)] p-3.5">
            {peekable && onPeek && (
              <p className="text-[11px] leading-snug text-[var(--color-faint)]">
                {peeked
                  ? "Peeked — befriend someone here to keep this region in your sky."
                  : "Beyond your galaxy. Peek to reveal its neighborhood, or connect to keep it."}
              </p>
            )}

            {/* Primary: not yet connected → bring them into your sky. */}
            {!node.isMe && !connected && (
              <button className="btn-accent w-full" disabled={pending} onClick={() => onConnect(node.id)}>
                {node.type === "person" ? (
                  <>
                    <UserPlus size={14} /> Befriend
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Add to my sky
                  </>
                )}
              </button>
            )}
            {/* Primary: connected person/provider → Recommend (the merged
                Trust+Recommend action; form expands inline). Restaurants/cafes
                get theirs inside PlaceDetail — don't double it. */}
            {!node.isMe && connected && !isPlaceNode(node) &&
              (node.type === "person" || node.type === "location") && (
                <RecommendButton targetId={node.id} targetLabel={node.label} nodeType={node.type} primary />
              )}
            {/* Not connected yet: the trust/recommend form stays reachable
                below the primary as a soft button. */}
            {!node.isMe && !connected && !isPlaceNode(node) &&
              (node.type === "person" || node.type === "location") && (
                <RecommendButton targetId={node.id} targetLabel={node.label} nodeType={node.type} />
              )}

            {/* Secondary icon row */}
            <div className="flex items-start justify-center gap-3 pt-0.5">
              <IconAction label="Focus" onClick={() => onFocus(node.id)}>
                <Crosshair size={15} />
              </IconAction>
              {!node.isMe && (
                <IconAction label="Path" onClick={() => onTrace(node.id)}>
                  <Route size={15} />
                </IconAction>
              )}
              {peekable && onPeek && (
                <IconAction
                  label={`Peek ✦${peekCost}`}
                  accentLabel
                  disabled={pending}
                  onClick={() => onPeek(node.id)}
                  title="Spend tokens to reveal this region — fades unless you connect"
                >
                  <Eye size={15} />
                </IconAction>
              )}
              {!node.isMe && node.type === "person" && (
                <div className="flex w-[52px] flex-col items-center gap-1">
                  <ListenButton targetId={node.id} targetLabel={node.label} variant="icon" />
                  <span className="text-[9.5px] text-[var(--color-faint)]">Listen</span>
                </div>
              )}
              {!node.isMe && connected && (
                <IconAction
                  label={node.type === "person" ? "Unfriend" : "Remove"}
                  disabled={pending}
                  onClick={() => onConnect(node.id)}
                  title={node.type === "person" ? "Remove the friendship" : "Remove from your sky"}
                >
                  <UserMinus size={15} />
                </IconAction>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
