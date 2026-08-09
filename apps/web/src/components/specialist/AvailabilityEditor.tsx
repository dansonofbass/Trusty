"use client";

/**
 * Weekly availability + session price.
 *
 * Publishing every slot by hand is why almost nobody had any to book: an
 * expert states a PATTERN once ("Tuesdays and Thursdays, 18:00–20:00, 30-minute
 * sessions") and the server generates concrete slots forward from it, topping
 * the window up on every read. One-off times still work — this sits above them.
 *
 * Times are entered in the viewer's own zone and sent as UTC minutes; the
 * server stores UTC so an expert in Yerevan and someone booking from Tehran
 * never see two different times for one session.
 */
import { useState } from "react";
import { CalendarClock, Coins, Loader2 } from "lucide-react";
import {
  hhmmToMinutes,
  minutesToHHMM,
  saveAvailability,
  saveSessionPrice,
  type AvailabilityRule,
  type SessionPrice,
} from "@/lib/bookingClient";
import { useT, type TranslationKey } from "@/lib/i18n";

/** Sunday-first, matching JS getUTCDay(). */
const WEEKDAY_KEYS: TranslationKey[] = [
  "day.sun", "day.mon", "day.tue", "day.wed", "day.thu", "day.fri", "day.sat",
];

const DEFAULT_RULE = { startMinute: 18 * 60, endMinute: 20 * 60, sessionMinutes: 30 };
const CURRENCIES = ["AMD", "USD", "EUR", "IRR"];

export default function AvailabilityEditor({
  nodeId,
  initialRules,
  initialPrice,
  onSaved,
}: {
  nodeId: string;
  initialRules: AvailabilityRule[];
  initialPrice: SessionPrice | null;
  onSaved: () => void;
}) {
  const t = useT();
  const [rules, setRules] = useState<AvailabilityRule[]>(initialRules);
  const [amount, setAmount] = useState(initialPrice?.amount ? String(initialPrice.amount) : "");
  const [currency, setCurrency] = useState(initialPrice?.currency ?? "AMD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  const ruleFor = (weekday: number) => rules.find((r) => r.weekday === weekday);

  const toggleDay = (weekday: number) => {
    setRules((prev) =>
      prev.some((r) => r.weekday === weekday)
        ? prev.filter((r) => r.weekday !== weekday)
        : [...prev, { weekday, ...DEFAULT_RULE }].sort((a, b) => a.weekday - b.weekday),
    );
  };

  const patch = (weekday: number, p: Partial<AvailabilityRule>) =>
    setRules((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...p } : r)));

  /** How many sessions the current pattern yields in a week — the number that
   *  tells an expert whether they've actually offered anything. */
  const weeklySessions = rules.reduce(
    (n, r) => n + Math.max(0, Math.floor((r.endMinute - r.startMinute) / r.sessionMinutes)),
    0,
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await saveAvailability(nodeId, rules);
      await saveSessionPrice(nodeId, Number(amount) || 0, currency);
      setCreated(r.created);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-line p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
        <CalendarClock size={12} /> {t("availability.title")}
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-dim)]">{t("availability.intro")}</p>

      <div className="mt-2.5 space-y-1.5">
        {WEEKDAY_KEYS.map((key, weekday) => {
          const rule = ruleFor(weekday);
          return (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => toggleDay(weekday)}
                className="w-[76px] shrink-0 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition"
                style={
                  rule
                    ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                    : { borderColor: "var(--color-line)", color: "var(--color-faint)" }
                }
              >
                {t(key)}
              </button>
              {rule && (
                <>
                  <input
                    type="time"
                    value={minutesToHHMM(rule.startMinute)}
                    onChange={(e) => patch(weekday, { startMinute: hhmmToMinutes(e.target.value) })}
                    className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none"
                  />
                  <span className="text-[11px] text-[var(--color-faint)]">—</span>
                  <input
                    type="time"
                    value={minutesToHHMM(rule.endMinute)}
                    onChange={(e) => patch(weekday, { endMinute: hhmmToMinutes(e.target.value) })}
                    className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none"
                  />
                  <select
                    value={rule.sessionMinutes}
                    onChange={(e) => patch(weekday, { sessionMinutes: Number(e.target.value) })}
                    className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none"
                  >
                    {[15, 30, 45, 60, 90].map((m) => (
                      <option key={m} value={m} className="bg-[#111827]">
                        {t("availability.minutes", { count: m })}
                      </option>
                    ))}
                  </select>
                  {/* A window shorter than one session silently produces nothing,
                      so say so here rather than after saving. */}
                  {rule.endMinute - rule.startMinute < rule.sessionMinutes && (
                    <span className="text-[11px] text-rose-300">{t("availability.windowTooShort")}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="text-[11px] text-[var(--color-faint)]">
          <span className="mb-1 flex items-center gap-1"><Coins size={11} /> {t("availability.price")}</span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={t("availability.priceFree")}
            className="w-[120px] rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
        </label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c} className="bg-[#111827]">{c}</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-faint)]">{t("availability.priceHint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
        >
          {busy ? <Loader2 size={12} className="inline animate-spin" /> : t("common.save")}
        </button>
        <span className="text-[11px] text-[var(--color-faint)]">
          {t("availability.weeklyCount", { count: weeklySessions })}
        </span>
        {created !== null && (
          <span className="text-[11px]" style={{ color: "#54d26e" }}>
            {t("availability.created", { count: created })}
          </span>
        )}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-rose-300">{error}</p>}
    </div>
  );
}
