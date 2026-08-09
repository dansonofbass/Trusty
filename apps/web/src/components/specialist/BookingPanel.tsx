"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import AvailabilityEditor from "./AvailabilityEditor";
import { formatPrice, type AvailabilityRule, type SessionPrice } from "@/lib/bookingClient";

/**
 * Session times on a specialist profile.
 *
 * Two audiences, one panel: a visitor sees open times and books one; a manager
 * also sees booked times and can publish/withdraw. Free in v1 — the survey is
 * still measuring what people would pay, and proving people book at all is the
 * cheaper question.
 */

interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "open" | "booked" | "cancelled";
  bookedBy?: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function BookingPanel({ nodeId }: { nodeId: string }) {
  const { t, locale } = useI18n();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [verified, setVerified] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityRule[]>([]);
  const [price, setPrice] = useState<SessionPrice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(30);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/specialists/${encodeURIComponent(nodeId)}/slots`, { cache: "no-store" });
      const d = (await r.json()) as {
        slots: Slot[];
        canManage: boolean;
        verified: boolean;
        availability?: AvailabilityRule[];
        price?: SessionPrice | null;
      };
      setSlots(d.slots ?? []);
      setCanManage(!!d.canManage);
      setVerified(!!d.verified);
      setAvailability(d.availability ?? []);
      setPrice(d.price ?? null);
    } catch {
      setSlots([]);
    }
  }, [nodeId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (url: string, body?: unknown) => {
    setError(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `failed (${r.status})`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const publish = async () => {
    if (!start) return;
    const startsAt = new Date(start);
    if (Number.isNaN(startsAt.getTime())) return setError(t("booking.invalidTime"));
    setBusy("new");
    const ok = await act(`/api/specialists/${encodeURIComponent(nodeId)}/slots`, {
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
    });
    if (ok) {
      setStart("");
      setAdding(false);
    }
    setBusy(null);
  };

  // Nothing to show a visitor when there's no availability and they can't add any.
  if (slots !== null && slots.length === 0 && !canManage) return null;

  return (
    <section className="panel mt-4 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-wide text-faint">
          <CalendarClock size={14} /> {t("booking.sessions")}
          {/* Advertised, not charged: v1 settles between the two people, so the
              number has to be visible before anyone taps "book". */}
          {price && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal"
              style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
            >
              {formatPrice(price, locale)}
            </span>
          )}
        </h2>
        {canManage && verified && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] text-dim hover:text-ink"
          >
            <Plus size={12} /> {t("booking.addSlot")}
          </button>
        )}
      </div>

      {canManage && !verified && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">{t("booking.verifyFirst")}</p>
      )}

      {canManage && verified && (
        <AvailabilityEditor
          nodeId={nodeId}
          initialRules={availability}
          initialPrice={price}
          onSaved={() => void load()}
        />
      )}

      {adding && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
          <label className="text-[11.5px] text-faint">
            <span className="mb-1 block">{t("booking.startTime")}</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
            />
          </label>
          <label className="text-[11.5px] text-faint">
            <span className="mb-1 block">{t("booking.duration")}</span>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
            >
              {[15, 30, 45, 60].map((m) => (
                <option key={m} value={m} className="bg-[#111827]">{m} min</option>
              ))}
            </select>
          </label>
          <button
            disabled={busy === "new" || !start}
            onClick={() => void publish()}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {busy === "new" ? <Loader2 size={12} className="animate-spin" /> : t("booking.publish")}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}

      {slots === null ? (
        <Loader2 size={15} className="mt-3 animate-spin text-faint" />
      ) : slots.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-faint">{t("booking.noSlots")}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1 text-[12.5px] text-ink">{fmt(s.startsAt)}</span>
              <span className="shrink-0 text-[11px] text-faint">
                {Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000)} min
              </span>
              {s.status === "booked" ? (
                <>
                  <span className="shrink-0 text-[11px] font-semibold" style={{ color: "#54d26e" }}>
                    <Check size={11} className="inline" /> {t("booking.booked")}
                  </span>
                  <button
                    disabled={busy === s.id}
                    onClick={async () => {
                      setBusy(s.id);
                      await act(`/api/specialists/${encodeURIComponent(nodeId)}/slots/${encodeURIComponent(s.id)}/cancel`);
                      setBusy(null);
                    }}
                    className="shrink-0 text-[11px] text-faint hover:text-rose-300"
                  >
                    {t("booking.cancel")}
                  </button>
                </>
              ) : canManage ? (
                <button
                  disabled={busy === s.id}
                  onClick={async () => {
                    setBusy(s.id);
                    setError(null);
                    try {
                      const r = await fetch(
                        `/api/specialists/${encodeURIComponent(nodeId)}/slots/${encodeURIComponent(s.id)}`,
                        { method: "DELETE" },
                      );
                      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "failed");
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                  aria-label={t("booking.withdraw")}
                  className="shrink-0 text-faint hover:text-rose-300"
                >
                  <X size={13} />
                </button>
              ) : (
                <button
                  disabled={busy === s.id}
                  onClick={async () => {
                    setBusy(s.id);
                    await act(`/api/specialists/${encodeURIComponent(nodeId)}/slots/${encodeURIComponent(s.id)}/book`);
                    setBusy(null);
                  }}
                  className="shrink-0 rounded-lg px-3 py-1 text-[12px] font-bold text-space disabled:opacity-50"
                  style={{ background: "var(--color-accent)" }}
                >
                  {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : t("booking.book")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
