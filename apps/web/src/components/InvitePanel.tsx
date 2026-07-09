"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Copy, Check, Share2, Users, Eye } from "lucide-react";
import { GOLD } from "@/lib/palette";
import { useUI } from "@/lib/store";
import {
  createInvite,
  inviteUrl,
  listInvites,
  type InviteRow,
  type InviteStats,
} from "@/lib/inviteClient";

/**
 * Invite panel — the network's growth loop, made a first-class action.
 *
 * Trust-search is only as good as your network, so inviting the friends whose
 * taste you trust is THE core action. This surfaces it (mint + copy + native
 * share) and, crucially, shows the conversion funnel back to the inviter
 * (viewed → joined) — both instrumentation and motivation ("2 friends joined").
 */
export default function InvitePanel() {
  const open = useUI((s) => s.inviteOpen);
  const setOpen = useUI((s) => s.setInviteOpen);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshCode, setFreshCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listInvites();
      setInvites(data.invites);
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const mint = async () => {
    setCreating(true);
    setError(null);
    try {
      const { code } = await createInvite();
      setFreshCode(code);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur-md hover:border-gold/60"
        style={{ fontFamily: "var(--font-display)", borderColor: open ? "rgba(255,217,122,0.6)" : undefined }}
      >
        <UserPlus size={15} /> Invite
      </button>

      {open && (
        <aside className="pointer-events-auto fixed bottom-4 right-4 top-20 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              Grow your trusted network
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="text-dim hover:text-ink">
              ✕
            </button>
          </div>

          <div className="border-b border-line px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-dim">
              Trust search is only as good as your network. Invite the friends whose
              taste you actually trust — they join already connected to you.
            </p>
            <button
              type="button"
              onClick={mint}
              disabled={creating}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-bold text-space transition hover:brightness-110 disabled:opacity-60"
              style={{ fontFamily: "var(--font-display)", background: GOLD }}
            >
              <UserPlus size={15} /> {creating ? "Creating…" : "Create invite link"}
            </button>
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          </div>

          {/* Headline funnel — the growth metric, shown to the user. */}
          {stats && stats.invitesCreated > 0 && (
            <div className="grid grid-cols-3 gap-px border-b border-line bg-line/40 text-center">
              <Stat label="Links" value={stats.invitesCreated} />
              <Stat label="Viewed" value={stats.totalVisits} />
              <Stat label="Joined" value={stats.totalJoined} accent />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {loading && invites.length === 0 && <p className="text-sm text-dim">Loading…</p>}
            {!loading && invites.length === 0 && (
              <div className="rounded-lg border border-line bg-space/40 p-4 text-sm text-dim">
                No invites yet. Create a link and share it — you'll see here who views
                and joins.
              </div>
            )}
            <div className="space-y-2">
              {invites.map((inv) => (
                <InviteCard key={inv.code} inv={inv} highlight={inv.code === freshCode} />
              ))}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-nebula/95 px-2 py-2.5">
      <div
        className="text-[18px] font-bold"
        style={{ color: accent ? GOLD : "var(--color-ink)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div>
    </div>
  );
}

function InviteCard({ inv, highlight }: { inv: InviteRow; highlight: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(inv.code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the link is still selectable in the field */
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      await nav
        .share({ title: "Join me on Trusty", text: "Find people our network trusts.", url })
        .catch(() => undefined);
    } else {
      copy();
    }
  };

  return (
    <div
      className="rounded-xl border bg-space/40 p-3 transition"
      style={{ borderColor: highlight ? "rgba(255,217,122,0.6)" : "var(--color-line)" }}
    >
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2.5 py-1.5 text-[12px] text-dim outline-none"
        />
        <button
          type="button"
          onClick={copy}
          title="Copy link"
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-dim hover:border-gold/60 hover:text-ink"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          onClick={share}
          title="Share"
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-dim hover:border-gold/60 hover:text-ink"
        >
          <Share2 size={14} />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1">
          <Eye size={12} /> {inv.visits} viewed
        </span>
        <span className="inline-flex items-center gap-1" style={{ color: inv.joined ? GOLD : undefined }}>
          <Users size={12} /> {inv.joined} joined
        </span>
        {inv.revoked && <span className="text-rose-300">revoked</span>}
      </div>

      {inv.joinedNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {inv.joinedNames.map((name, i) => (
            <span
              key={i}
              className="rounded-full border px-2 py-0.5 text-[10.5px] text-ink"
              style={{ borderColor: "rgba(255,217,122,0.4)" }}
            >
              🤝 {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
