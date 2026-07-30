"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MessageCircle,
  MessagesSquare,
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
import { fetchWorkspace, type FolderRow, type WritingSummary } from "@/lib/writings";
import { listConversations, type ConversationSummary } from "@/lib/chat/conversationsClient";
import { fetchRooms } from "@/lib/socialClient";
import NotificationBell from "@/components/NotificationBell";
import { SPACE_META, SPACE_SLUGS, homeUrl, spaceFromHost, spaceUrl } from "@/lib/space";
import { useChat } from "@/lib/chat/ChatProvider";
import SidebarFooter from "./SidebarFooter";

const NAV: { href: string; label: string; icon: React.ElementType }[] = [
  { href: "/", label: "Chat", icon: MessageCircle },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
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
export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const setRightPanel = useUI((s) => s.setRightPanel);
  const setPaletteOpen = useUI((s) => s.setPaletteOpen);
  const docsNonce = useUI((s) => s.docsNonce);
  const chatsNonce = useUI((s) => s.chatsNonce);
  const [unreadAsks, setUnreadAsks] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [docs, setDocs] = useState<WritingSummary[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  // Obsidian-style tree: collapse state survives reloads.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("trusty-folders-open") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("trusty-folders-open", JSON.stringify([...next]));
      return next;
    });
  };
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const { conversationId, loadConversation, newChat, sending } = useChat();

  useEffect(() => {
    let alive = true;
    listConversations()
      .then((cs) => alive && setChats(cs.slice(0, 8)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatsNonce]);

  const openChat = (id: string) => {
    if (sending) return; // don't yank a streaming thread out from under itself
    void loadConversation(id).catch(() => {});
    router.push("/");
    onNavigate?.();
  };

  const startNewChat = () => {
    if (sending) return;
    newChat();
    router.push("/");
    onNavigate?.();
  };

  useEffect(() => {
    let alive = true;
    askInbox()
      .then((inbox) => alive && setUnreadAsks(inbox.length))
      .catch(() => {});
    fetchRooms()
      .then((r) => alive && setUnreadMsgs(r.rooms.reduce((n, room) => n + room.unread, 0)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    let alive = true;
    fetchWorkspace()
      .then((w) => {
        if (!alive) return;
        setDocs(w.writings);
        setFolders(w.folders);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docsNonce]);

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-[color-mix(in_srgb,var(--color-card)_70%,transparent)] backdrop-blur-md max-md:w-full max-md:bg-[var(--color-card)]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Brand />
        <span className="ml-auto md:block max-md:hidden">
          <NotificationBell className="!h-8 !w-8" />
        </span>
      </div>

      {/* Search / palette */}
      <button
        type="button"
        onClick={() => {
          setPaletteOpen(true);
          onNavigate?.();
        }}
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
            onClick={onNavigate}
            className="mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition"
            style={
              active(n.href)
                ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { color: "var(--color-dim)" }
            }
          >
            <n.icon size={15} strokeWidth={2.2} />
            <span className="flex-1">{n.label}</span>
            {n.href === "/messages" && unreadMsgs > 0 && (
              <span
                className="grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold"
                style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
              >
                {unreadMsgs > 9 ? "9+" : unreadMsgs}
              </span>
            )}
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

      {/* Spaces — community front doors (subdomains). Current one highlighted. */}
      <div className="mt-3 px-2">
        <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          Spaces
        </div>
        {(() => {
          const current = spaceFromHost();
          return (
            <ul>
              {current !== null && (
                <li>
                  <a
                    href={homeUrl()}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                  >
                    <span>🏠</span>
                    <span className="min-w-0 flex-1 truncate">Trusty home</span>
                  </a>
                </li>
              )}
              {SPACE_SLUGS.map((slug) => (
                <li key={slug}>
                  <a
                    href={current === slug ? undefined : spaceUrl(slug)}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] transition hover:bg-[var(--color-tint)]"
                    style={
                      current === slug
                        ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                        : { color: "var(--color-dim)" }
                    }
                    title={SPACE_META[slug].tagline}
                  >
                    <span>{SPACE_META[slug].emoji}</span>
                    <span className="min-w-0 flex-1 truncate">{SPACE_META[slug].label}</span>
                  </a>
                </li>
              ))}
            </ul>
          );
        })()}
      </div>

      {/* Chats history (Phase 2 — persisted conversations) */}
      <div className="mt-3 px-2">
        <div className="mb-1 flex items-center justify-between px-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            <MessageCircle size={11} /> Chats
          </span>
          <button
            type="button"
            title="New chat"
            onClick={startNewChat}
            className="rounded p-1 text-[var(--color-faint)] transition hover:text-ink"
          >
            <Plus size={12} />
          </button>
        </div>
        {chats.length === 0 ? (
          <p className="px-3 py-1 text-[11px] leading-snug text-[var(--color-faint)]">
            Conversations you start will resume from here.
          </p>
        ) : (
          <ul className="max-h-[168px] overflow-y-auto scroll-quiet">
            {chats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openChat(c.id)}
                  className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-[12px] transition hover:bg-[var(--color-tint)] hover:text-ink"
                  style={
                    conversationId === c.id && pathname === "/"
                      ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                      : { color: "var(--color-dim)" }
                  }
                  title={c.title}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Docs directory (flat in P1; folder tree = Phase 3) */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-quiet">
        <div className="mb-1 flex items-center justify-between px-3">
          <Link
            href="/docs"
            onClick={onNavigate}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)] transition hover:text-ink"
          >
            <FileText size={11} /> Docs
          </Link>
          <button
            type="button"
            title="New doc"
            onClick={() => {
              router.push("/docs?new=1");
              onNavigate?.();
            }}
            className="rounded p-1 text-[var(--color-faint)] transition hover:text-ink"
          >
            <Plus size={12} />
          </button>
        </div>
        {docs.length === 0 && folders.length === 0 ? (
          <p className="px-3 py-1 text-[11px] leading-snug text-[var(--color-faint)]">
            Your notes and drafts will appear here.
          </p>
        ) : (
          <ul>
            {/* Obsidian-style tree: folders first (collapsible), unfiled after. */}
            {folders
              .filter((f) => !f.parentId)
              .map((f) => {
                const inFolder = docs.filter((d) => d.folderId === f.id);
                const open = expanded.has(f.id);
                return (
                  <li key={`f_${f.id}`}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(f.id)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                    >
                      {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      {open ? <FolderOpen size={12} className="shrink-0" /> : <Folder size={12} className="shrink-0" />}
                      <span className="min-w-0 flex-1 truncate text-left">{f.name}</span>
                      <span className="text-[10px] text-[var(--color-faint)]">{inFolder.length}</span>
                    </button>
                    {open && (
                      <ul className="ml-4 border-l border-[var(--color-line)] pl-1.5">
                        {inFolder.length === 0 && (
                          <li className="px-2 py-1 text-[10.5px] text-[var(--color-faint)]">empty</li>
                        )}
                        {inFolder.map((d) => (
                          <li key={d.id}>
                            <Link
                              href={`/docs?open=${encodeURIComponent(d.id)}`}
                              onClick={onNavigate}
                              className="flex items-center gap-1.5 truncate rounded-lg px-2 py-1 text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                              title={d.title || "Untitled"}
                            >
                              <FileText size={11} className="shrink-0 text-[var(--color-faint)]" />
                              <span className="min-w-0 truncate">{d.title || "Untitled"}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            {docs
              .filter((d) => !d.folderId)
              .slice(0, 12)
              .map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/docs?open=${encodeURIComponent(d.id)}`}
                    onClick={onNavigate}
                    className="flex items-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
                    title={d.title || "Untitled"}
                  >
                    <FileText size={11} className="shrink-0 text-[var(--color-faint)]" />
                    <span className="min-w-0 truncate">{d.title || "Untitled"}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            setRightPanel("addEntity");
            onNavigate?.();
          }}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-3 py-2 text-[12px] text-[var(--color-faint)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
        >
          <Plus size={13} /> Add an entity
        </button>
      </div>

      <SidebarFooter />
    </aside>
  );
}
