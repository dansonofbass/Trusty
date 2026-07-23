"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileText,
  MessageCircle,
  Megaphone,
  Orbit,
  Plus,
  Radio,
  Scale,
  Search,
} from "lucide-react";
import Brand from "@/components/Brand";
import { useUI } from "@/lib/store";
import { askInbox } from "@/lib/asksClient";
import { fetchWorkspace, type WritingSummary } from "@/lib/writings";
import SidebarFooter from "./SidebarFooter";

const NAV: { href: string; label: string; icon: React.ElementType }[] = [
  { href: "/", label: "Chat", icon: MessageCircle },
  { href: "/discover", label: "Discover", icon: Radio },
  { href: "/graph", label: "Graph", icon: Orbit },
  { href: "/asks", label: "Asks", icon: Megaphone },
  { href: "/decisions", label: "Decisions", icon: Scale },
];

/**
 * Workspace shell sidebar: brand, nav, the doc directory (flat in P1 — the
 * folder tree lands with Phase 3), and the account/wallet footer. Chats
 * history joins in Phase 2 (conversations are session-ephemeral today).
 */
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const setRightPanel = useUI((s) => s.setRightPanel);
  const setPaletteOpen = useUI((s) => s.setPaletteOpen);
  const docsNonce = useUI((s) => s.docsNonce);
  const [unreadAsks, setUnreadAsks] = useState(0);
  const [docs, setDocs] = useState<WritingSummary[]>([]);

  useEffect(() => {
    let alive = true;
    askInbox()
      .then((inbox) => alive && setUnreadAsks(inbox.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    let alive = true;
    fetchWorkspace()
      .then((w) => alive && setDocs(w.writings.slice(0, 8)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docsNonce]);

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-[color-mix(in_srgb,var(--color-card)_70%,transparent)] backdrop-blur-md">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Brand />
      </div>

      {/* Search / palette */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-3 flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-3 py-2 text-[12.5px] text-[var(--color-faint)] transition hover:border-[rgba(146,166,255,0.35)] hover:text-ink"
      >
        <Search size={14} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded bg-[rgba(146,166,255,0.12)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>

      <nav className="px-2" aria-label="Workspace">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition"
            style={
              active(n.href)
                ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { color: "var(--color-dim)" }
            }
          >
            <n.icon size={15} strokeWidth={2.2} />
            <span className="flex-1">{n.label}</span>
            {n.href === "/asks" && unreadAsks > 0 && (
              <span
                className="grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold"
                style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
              >
                {unreadAsks > 9 ? "9+" : unreadAsks}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Docs directory (flat in P1; folder tree = Phase 3) */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-quiet">
        <div className="mb-1 flex items-center justify-between px-3">
          <Link
            href="/docs"
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)] transition hover:text-ink"
          >
            <FileText size={11} /> Docs
          </Link>
          <button
            type="button"
            title="New doc"
            onClick={() => router.push("/docs?new=1")}
            className="rounded p-1 text-[var(--color-faint)] transition hover:text-ink"
          >
            <Plus size={12} />
          </button>
        </div>
        {docs.length === 0 ? (
          <p className="px-3 py-1 text-[11px] leading-snug text-[var(--color-faint)]">
            Your notes and drafts will appear here.
          </p>
        ) : (
          <ul>
            {docs.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/docs?open=${encodeURIComponent(d.id)}`}
                  className="block truncate rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                  title={d.title || "Untitled"}
                >
                  {d.title || "Untitled"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setRightPanel("addEntity")}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-3 py-2 text-[12px] text-[var(--color-faint)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
        >
          <Plus size={13} /> Add an entity
        </button>
      </div>

      <SidebarFooter />
    </aside>
  );
}
