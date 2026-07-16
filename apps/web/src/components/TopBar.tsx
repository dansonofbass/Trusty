"use client";

import { useEffect, useState } from "react";
import { Brain, LogOut, Orbit, Route, Search, Sparkles } from "lucide-react";
import type { Wallet } from "@constellation/graph-core";
import { GOLD } from "@/lib/palette";
import { useUI, type ViewId } from "@/lib/store";
import WalletPanel from "./WalletPanel";
import ContributionPanel from "./ContributionPanel";

const TABS: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: "universe", label: "Universe", icon: Orbit },
  { id: "path", label: "Path", icon: Route },
  { id: "write", label: "Write", icon: Brain },
];

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 pl-1">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 17 L10 7 L15 13 L20 5" stroke="rgba(146,166,255,0.55)" strokeWidth="1" />
        <circle cx="4" cy="17" r="2" fill="#7c96ff" />
        <circle cx="10" cy="7" r="1.6" fill="#e25cff" />
        <circle cx="15" cy="13" r="1.6" fill="#2ee6ca" />
        <circle cx="20" cy="5" r="2.2" fill="#ffd97a" />
      </svg>
      <span
        className="hidden font-display text-[13px] font-bold tracking-[0.28em] text-ink lg:inline"
        style={{ fontFamily: "var(--font-display)" }}
      >
        TRUSTY
      </span>
    </div>
  );
}

export default function TopBar({
  wallet,
  onBuyTokens,
  pending,
}: {
  wallet: Wallet;
  onBuyTokens: () => void;
  pending: boolean;
}) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const user = useUI((s) => s.user);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const [walletOpen, setWalletOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);

  // "/" or ⌘K / Ctrl+K opens the unified search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (typing) return;
      if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return (
    <header className="rise pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4">
      <div className="panel pointer-events-auto flex w-full max-w-6xl items-center gap-2 px-3.5 py-2.5">
        <Wordmark />

        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              data-active={view === t.id}
              onClick={() => setView(t.id)}
            >
              <t.icon size={14} strokeWidth={2.2} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Search → unified entity + trust search overlay */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Search your universe or ask your network (⌘K)"
            className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-3 py-2 text-[12.5px] text-[var(--color-faint)] transition hover:border-[rgba(146,166,255,0.35)] hover:text-ink"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search…</span>
            <kbd className="hidden rounded bg-[rgba(146,166,255,0.12)] px-1.5 py-0.5 text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setContribOpen((v) => !v)}
              title="My contribution — score, Listen slots and credits"
              className="flex items-center rounded-lg border border-[rgba(146,166,255,0.25)] bg-[rgba(146,166,255,0.06)] px-2.5 py-1.5 transition hover:border-[rgba(146,166,255,0.45)]"
              aria-expanded={contribOpen}
            >
              <Sparkles size={13} className="text-[var(--color-dim)]" />
            </button>
            {contribOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setContribOpen(false)} aria-hidden />
                <ContributionPanel onClose={() => setContribOpen(false)} />
              </>
            )}
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setWalletOpen((v) => !v)}
              title="Your tokens — what they're for and your activity"
              className="flex items-center rounded-lg border border-[rgba(255,217,122,0.3)] bg-[rgba(255,217,122,0.06)] px-2.5 py-1.5 transition hover:border-[rgba(255,217,122,0.5)]"
              aria-expanded={walletOpen}
            >
              <span
                className="whitespace-nowrap text-[12px] font-semibold"
                style={{ color: GOLD, fontFamily: "var(--font-mono)" }}
              >
                ✦ {wallet.balance}
              </span>
            </button>
            {walletOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setWalletOpen(false)}
                  aria-hidden
                />
                <WalletPanel
                  wallet={wallet}
                  pending={pending}
                  onBuy={onBuyTokens}
                  onClose={() => setWalletOpen(false)}
                />
              </>
            )}
          </div>

          {user && (
            <div className="flex shrink-0 items-center gap-1.5 border-l border-[var(--color-line)] pl-2">
              <span
                className="hidden max-w-[110px] truncate text-[12px] text-[var(--color-dim)] sm:inline"
                title={user.email ?? user.name}
              >
                {user.name ?? "You"}
              </span>
              <a href="/api/auth/logout" className="btn" title="Sign out" aria-label="Sign out">
                <LogOut size={13} />
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
