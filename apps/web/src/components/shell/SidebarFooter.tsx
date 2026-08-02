"use client";

import FeedbackButton from "@/components/FeedbackButton";
import QRConnectHost from "@/components/shell/QRConnectHost";
import { useState } from "react";
import { LogOut, MapPin, Sparkles, UserPlus } from "lucide-react";
import GeoSelect from "@/components/GeoSelect";
import WalletPanel from "@/components/WalletPanel";
import ChatCreditsChip from "@/components/billing/ChatCreditsChip";
import LanguageToggle from "./LanguageToggle";
import ContributionPanel from "@/components/ContributionPanel";
import { useUI } from "@/lib/store";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { GOLD } from "@/lib/palette";

/**
 * The sidebar footer — everything that lived on the old TopBar's right side:
 * geo scope, contribution + wallet popovers (opening upward), invite, and the
 * signed-in identity.
 */
export default function SidebarFooter() {
  const { wallet, pending, handleBuyTokens } = useGraphData();
  const user = useUI((s) => s.user);
  const geoScope = useUI((s) => s.geoScope);
  const setGeoScope = useUI((s) => s.setGeoScope);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const [walletOpen, setWalletOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);

  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      {/* Location scope — flows into every location field + the agent. */}
      <GeoSelect
        value={geoScope}
        onChange={setGeoScope}
        icon={<MapPin size={13} className="shrink-0" style={{ color: "var(--color-accent)" }} />}
        className="mb-2 flex w-full shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-tint-soft)] px-2.5 py-2 text-[12px] font-medium text-ink transition hover:border-[var(--color-accent-line)]"
      />
      <QRConnectHost />
      <div className="mb-2"><FeedbackButton /></div>
      <div className="mb-2"><ChatCreditsChip /></div>
      <div className="mb-2"><LanguageToggle /></div>

      <div className="flex items-center gap-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setWalletOpen((v) => !v)}
            title="Your tokens — what they're for and your activity"
            aria-expanded={walletOpen}
            className="flex items-center rounded-lg border border-[rgba(255,140,90,0.3)] bg-[rgba(255,140,90,0.06)] px-2.5 py-1.5 transition hover:border-[rgba(255,140,90,0.5)]"
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
              <div className="fixed inset-0 z-40" onClick={() => setWalletOpen(false)} aria-hidden />
              <WalletPanel
                wallet={wallet}
                pending={pending}
                onBuy={handleBuyTokens}
                onClose={() => setWalletOpen(false)}
                placement="above"
              />
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setContribOpen((v) => !v)}
            title="My contribution — score, Listen slots and credits"
            aria-expanded={contribOpen}
            className="flex items-center rounded-lg border border-[rgba(146,166,255,0.25)] bg-[rgba(146,166,255,0.06)] px-2.5 py-1.5 transition hover:border-[rgba(146,166,255,0.45)]"
          >
            <Sparkles size={13} className="text-[var(--color-dim)]" />
          </button>
          {contribOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setContribOpen(false)} aria-hidden />
              <ContributionPanel onClose={() => setContribOpen(false)} placement="above" />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setRightPanel("invite")}
          title="Invite — grow your trusted network"
          className="flex items-center rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-2.5 py-1.5 text-[var(--color-dim)] transition hover:border-[rgba(146,166,255,0.45)] hover:text-ink"
        >
          <UserPlus size={13} />
        </button>
      </div>

      {user && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--color-line)] pt-2">
          <span
            className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-dim)]"
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
  );
}
