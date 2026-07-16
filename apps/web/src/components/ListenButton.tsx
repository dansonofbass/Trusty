"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ear, Loader2 } from "lucide-react";

/**
 * Listen to a person (#7/#23) — asks for the recommendation-permission
 * relationship. Directional, acceptance-based, capacity-bounded, and NEVER
 * trust: it only makes their future recommendations eligible for you.
 * Shows the live state: not listening → ask; pending → waiting; listening →
 * chip with stop. Sits beside TrustButton on person nodes.
 */
export default function ListenButton({ targetId, targetLabel }: { targetId: string; targetLabel: string }) {
  const [state, setState] = useState<"loading" | "none" | "pending" | "listening">("loading");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([
        fetch("/api/listen", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/listen/requests", { cache: "no-store" }).then((x) => x.json()),
      ]);
      setRemaining(l.slots?.remaining ?? null);
      if ((l.listening ?? []).some((p: { id: string }) => p.id === targetId)) setState("listening");
      else if ((r.outgoing ?? []).some((q: { targetId: string }) => q.targetId === targetId)) setState("pending");
      else setState("none");
    } catch {
      setState("none");
    }
  }, [targetId]);

  useEffect(() => {
    setMsg(null);
    void reload();
  }, [reload]);

  const ask = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/listen/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      const body = await r.json();
      if (!r.ok) setMsg(body.error ?? "Couldn't send the request.");
      else if (body.status === "accepted") setState("listening");
      else setState("pending");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await fetch(`/api/listen/${encodeURIComponent(targetId)}`, { method: "DELETE" });
      setState("none");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return null;

  if (state === "listening") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[rgba(63,198,244,0.35)] bg-[rgba(63,198,244,0.06)] px-3 py-2">
        <Ear size={13} className="shrink-0 text-[#3fc6f4]" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
          You listen to {targetLabel} <span className="text-[var(--color-faint)]">— their recommendations reach you</span>
        </span>
        <button type="button" disabled={busy} onClick={() => void stop()}
          className="shrink-0 text-[11px] text-[var(--color-faint)] hover:text-[#ff9a90]">
          {busy ? "…" : "stop"}
        </button>
      </div>
    );
  }

  if (state === "pending") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.05)] px-3 py-2 text-[11.5px] text-[var(--color-dim)]">
        <Ear size={13} className="shrink-0" /> Listen request sent — waiting for {targetLabel} to accept
      </div>
    );
  }

  const noSlots = remaining !== null && remaining <= 0;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || noSlots}
        onClick={() => void ask()}
        className="btn w-full justify-center disabled:opacity-45"
        style={{ borderColor: "rgba(63,198,244,0.5)", color: "#3fc6f4" }}
        title="Their future recommendations become part of your network — never trust, never reciprocal"
      >
        {busy ? <Loader2 className="animate-spin" size={13} /> : <Ear size={13} />} Listen to {targetLabel}
      </button>
      {noSlots && (
        <span className="text-[10.5px] text-[var(--color-faint)]">
          No free slots — <Link href="/listen" className="underline hover:text-ink">manage listening</Link> or contribute to earn more.
        </span>
      )}
      {msg && <span className="text-[10.5px] text-[#ff9a90]">{msg}</span>}
    </div>
  );
}
