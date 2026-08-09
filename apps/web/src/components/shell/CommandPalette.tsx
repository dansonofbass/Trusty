"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck, CircleDot, FileText, Megaphone, MessageCircle, Orbit, Radio, Scale, Search, Sparkles,
} from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { NODE_COLOR } from "@/lib/palette";
import { useUI } from "@/lib/store";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { fetchWorkspace, type WritingSummary } from "@/lib/writings";
import { isCommunitySpace } from "@/lib/space";
import { useT, type TranslationKey } from "@/lib/i18n";

type ViewRow = { href: string; labelKey: TranslationKey; icon: React.ElementType };

/** Community spaces put the feed on "/" and the chat on "/ask"; everywhere else
 *  "/" IS the chat. The palette has to follow, or ⌘K → Chat lands on a feed. */
const viewsFor = (community: boolean): ViewRow[] => [
  community
    ? { href: "/", labelKey: "nav.topics", icon: CircleDot }
    : { href: "/", labelKey: "nav.chat", icon: MessageCircle },
  ...(community ? [{ href: "/ask", labelKey: "nav.ask", icon: MessageCircle } as ViewRow] : []),
  ...(community ? [{ href: "/experts", labelKey: "nav.experts", icon: BadgeCheck } as ViewRow] : []),
  { href: "/discover", labelKey: "nav.discover", icon: Radio },
  { href: "/graph", labelKey: "nav.graph", icon: Orbit },
  { href: "/docs", labelKey: "nav.docs", icon: FileText },
  { href: "/asks", labelKey: "nav.asks", icon: Megaphone },
  { href: "/decisions", labelKey: "nav.decisions", icon: Scale },
];

type Row =
  | ({ kind: "view" } & ViewRow)
  | { kind: "node"; node: GNode }
  | { kind: "doc"; doc: WritingSummary }
  | { kind: "ask"; query: string };

/**
 * ⌘K command palette — the navigation half of the old TrustSearch: jump to
 * entities, docs and views. The trust-Q&A half lives in the center chat now
 * ("Ask the agent" hands the query off with a prefill).
 */
export default function CommandPalette() {
  const t = useT();
  const router = useRouter();
  const { dataset } = useGraphData();
  const [community, setCommunity] = useState(false);
  useEffect(() => setCommunity(isCommunitySpace()), []);
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const select = useUI((s) => s.select);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);
  const setChatPrefill = useUI((s) => s.setChatPrefill);

  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<WritingSummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K opens the palette from anywhere — even mid-typing (it's a
  // deliberate chord); bare "/" only outside inputs (the chat hero autofocuses).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (!typing && e.key === "/") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCursor(0);
    fetchWorkspace()
      .then((w) => setDocs(w.writings))
      .catch(() => {});
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const views = viewsFor(community);
    const out: Row[] = [];
    if (!needle) {
      out.push(...views.map((v) => ({ kind: "view" as const, ...v })));
      out.push(...docs.slice(0, 4).map((doc) => ({ kind: "doc" as const, doc })));
      return out;
    }
    out.push(
      // Match the TRANSLATED label — typing «شبکه» must find the graph view.
      ...views.filter((v) => t(v.labelKey).toLowerCase().includes(needle)).map((v) => ({
        kind: "view" as const,
        ...v,
      })),
    );
    out.push(
      ...dataset.nodes
        .filter((n) => !n.isMe && n.label.toLowerCase().includes(needle))
        .slice(0, 7)
        .map((node) => ({ kind: "node" as const, node })),
    );
    out.push(
      ...docs
        .filter((d) => (d.title ?? "").toLowerCase().includes(needle))
        .slice(0, 4)
        .map((doc) => ({ kind: "doc" as const, doc })),
    );
    out.push({ kind: "ask", query: q.trim() });
    return out;
  }, [q, dataset.nodes, docs, community, t]);

  useEffect(() => setCursor(0), [rows.length]);

  if (!open) return null;

  const run = (row: Row) => {
    setOpen(false);
    if (row.kind === "view") router.push(row.href);
    else if (row.kind === "node") {
      select(row.node.id);
      requestGraphCenter(row.node.id);
      router.push("/graph");
    } else if (row.kind === "doc") {
      router.push(`/docs?open=${encodeURIComponent(row.doc.id)}`);
    } else {
      setChatPrefill(row.query);
      router.push(community ? "/ask" : "/");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-[rgba(2,4,14,0.6)] px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-full max-w-[560px] overflow-hidden rounded-2xl border border-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={15} className="text-[var(--color-faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && rows[cursor]) {
                e.preventDefault();
                run(rows[cursor]);
              }
            }}
            dir="auto"
            placeholder={t("palette.placeholder")}
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          <kbd className="rounded bg-[rgba(146,166,255,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--color-faint)]">esc</kbd>
        </div>

        <ul className="scroll-quiet max-h-[46vh] overflow-y-auto p-1.5">
          {rows.map((row, i) => {
            const active = i === cursor;
            const base =
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[12.5px] transition";
            const style = active
              ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
              : { color: "var(--color-dim)" };
            return (
              <li key={i}>
                {row.kind === "view" ? (
                  <button className={base} style={style} onClick={() => run(row)} onMouseEnter={() => setCursor(i)}>
                    <row.icon size={14} />
                    <span className="flex-1 text-ink">{t(row.labelKey)}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{t("palette.view")}</span>
                  </button>
                ) : row.kind === "node" ? (
                  <button className={base} style={style} onClick={() => run(row)} onMouseEnter={() => setCursor(i)}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: NODE_COLOR[row.node.type] }} />
                    <span className="min-w-0 flex-1 truncate text-ink">{row.node.label}</span>
                    {row.node.sub && (
                      <span className="max-w-[160px] truncate text-[10.5px] text-[var(--color-faint)]">{row.node.sub}</span>
                    )}
                  </button>
                ) : row.kind === "doc" ? (
                  <button className={base} style={style} onClick={() => run(row)} onMouseEnter={() => setCursor(i)}>
                    <FileText size={14} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-ink">{row.doc.title || t("docs.untitled")}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{t("palette.doc")}</span>
                  </button>
                ) : (
                  <button className={base} style={style} onClick={() => run(row)} onMouseEnter={() => setCursor(i)}>
                    <Sparkles size={14} style={{ color: "var(--color-accent)" }} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-ink">
                      {t("palette.askAgent", { query: row.query })}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
