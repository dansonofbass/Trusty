"use client";

/**
 * Book a specialist without leaving the conversation.
 *
 * `find_expert` returns each specialist WITH their open times, so the moment
 * the agent says "Sahak has three slots this week" the slots are right there.
 * Sending someone to a profile to find a calendar is where the intent dies.
 *
 * Booking happens against the same endpoint the profile panel uses — the
 * transaction that makes double-booking impossible lives in the database, not
 * here, so two people tapping the same chip cannot both win.
 */
import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, CalendarClock, Check, Loader2 } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import {
  bookSlot,
  formatPrice,
  formatSlotDay,
  formatSlotTime,
  type BookableExpert,
  type Slot,
} from "@/lib/bookingClient";
import { SPECIALIST_TYPE_FA, TRUST_LABEL_FA } from "@/lib/specialistClient";
import { useI18n } from "@/lib/i18n";

export interface ExpertsToolData {
  topic: string;
  experts: BookableExpert[];
}

export default function ExpertSlotsCard({ data }: { data: ExpertsToolData }) {
  const { t, locale } = useI18n();
  const [booked, setBooked] = useState<Record<string, Slot>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data.experts.length) return null;

  const book = async (expert: BookableExpert, slot: Slot) => {
    setBusy(slot.id);
    setError(null);
    try {
      await bookSlot(expert.nodeId, slot.id);
      setBooked((b) => ({ ...b, [expert.nodeId]: slot }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {data.experts.map((e) => {
        const mine = booked[e.nodeId];
        return (
          <div key={e.nodeId} className="rounded-2xl border border-line bg-[var(--color-surface)] p-3">
            <div className="flex items-center gap-2.5">
              <SpecialistAvatar label={e.label} photoUrl={e.photoUrl} size={34} rounded="rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <Link
                    href={`/s/${encodeURIComponent(e.nodeId)}`}
                    dir="auto"
                    className="truncate text-[13.5px] font-bold text-ink hover:underline"
                  >
                    {e.label}
                  </Link>
                  {e.verified && <BadgeCheck size={12} style={{ color: "var(--color-accent)" }} />}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--color-dim)]">
                  {(locale === "fa" ? SPECIALIST_TYPE_FA[e.nodeType] : undefined) ?? e.nodeType}
                  {" · "}
                  {(locale === "fa" ? TRUST_LABEL_FA[e.trustLabel] : undefined) ?? e.trustLabelText}
                </span>
              </span>
              {/* Price is advertised, not charged: v1 settles between the two
                  people, so nobody should tap "book" expecting free. */}
              {e.price && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                >
                  {formatPrice(e.price, locale)}
                </span>
              )}
            </div>

            {mine ? (
              <p
                className="mt-2 flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[12px] font-semibold"
                style={{ background: "rgba(84,210,110,0.1)", color: "#54d26e" }}
              >
                <Check size={13} />
                {t("booking.confirmedAt", {
                  day: formatSlotDay(mine.startsAt, locale),
                  time: formatSlotTime(mine.startsAt, locale),
                })}
              </p>
            ) : e.slots.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{t("booking.noSlotsShort")}</p>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-faint)]">
                  <CalendarClock size={11} /> {t("booking.pickATime")}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {e.slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void book(e, s)}
                      className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-semibold transition disabled:opacity-50"
                      style={{ borderColor: "var(--color-line)", color: "var(--color-dim)" }}
                    >
                      {busy === s.id ? <Loader2 size={11} className="animate-spin" /> : null}
                      <span dir="auto">
                        {formatSlotDay(s.startsAt, locale)} · {formatSlotTime(s.startsAt, locale)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
      {error && <p className="text-[11.5px] text-rose-300">{error}</p>}
    </div>
  );
}
