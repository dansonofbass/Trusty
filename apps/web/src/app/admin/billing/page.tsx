"use client";

/**
 * Admin billing desk — the manual settlement loop until a payment gateway
 * lands: see who asked for a pack, confirm the money arrived, mark it paid
 * (which grants the credits atomically), and set the payment contact users
 * see on their invoice.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Phone, X } from "lucide-react";
import {
  adminCancelInvoice, adminInvoices, adminPayInvoice, adminSavePayment, formatAmount,
  getBilling, type Invoice,
} from "@/lib/billingClient";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "rgba(255,140,90,0.12)", fg: "#ff8c5a", label: "Awaiting payment" },
  paid: { bg: "rgba(84,210,110,0.12)", fg: "#54d26e", label: "Paid" },
  canceled: { bg: "rgba(146,166,255,0.1)", fg: "#8e97bd", label: "Canceled" },
};

export default function AdminBillingPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [whatsapp, setWhatsapp] = useState("");
  const [note, setNote] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [savedContact, setSavedContact] = useState(false);

  const load = useCallback(() => {
    adminInvoices(filter === "all" ? undefined : filter)
      .then((r) => setInvoices(r.invoices))
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getBilling()
      .then((b) => {
        setWhatsapp(b.payment.whatsapp ?? "");
        setNote(b.payment.note ?? "");
      })
      .catch(() => {});
  }, []);

  const pay = async (inv: Invoice) => {
    setBusy(inv.id);
    setError(null);
    try {
      await adminPayInvoice(inv.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (inv: Invoice) => {
    setBusy(inv.id);
    try {
      await adminCancelInvoice(inv.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  };

  const saveContact = async () => {
    setSavingContact(true);
    setSavedContact(false);
    try {
      await adminSavePayment(whatsapp, note);
      setSavedContact(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6">
      <h1 className="text-[20px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
        Billing
      </h1>
      <p className="mb-5 mt-1 text-[13px] text-dim">
        Users buy AI-message packs; you confirm payment here and the credits are granted instantly.
      </p>

      {/* Payment contact */}
      <section className="mb-6 rounded-2xl border border-line p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">
          <Phone size={12} /> Payment contact (shown on every invoice)
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="WhatsApp number, e.g. +37477123456"
            className="flex-1 rounded-xl border border-line bg-transparent px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-accent-line)]"
          />
          <button
            type="button"
            onClick={() => void saveContact()}
            disabled={savingContact}
            className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-space disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {savingContact ? "Saving…" : savedContact ? "Saved ✓" : "Save"}
          </button>
        </div>
        <textarea
          dir="auto"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional note shown to the user (bank details, hours, language…)"
          className="mt-2 w-full resize-none rounded-xl border border-line bg-transparent px-3 py-2.5 text-[13px] text-ink outline-none focus:border-[var(--color-accent-line)]"
        />
      </section>

      {/* Invoices */}
      <div className="mb-2 flex items-center gap-1.5">
        {["pending", "paid", "canceled", "all"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold capitalize transition"
            style={
              filter === f
                ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
            }
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="mb-2 text-[12px] text-[#fda4af]">{error}</p>}

      {!invoices ? (
        <p className="py-6 text-center text-[13px] text-faint">
          <Loader2 size={14} className="inline animate-spin" />
        </p>
      ) : invoices.length === 0 ? (
        <p className="rounded-xl border border-line p-6 text-center text-[13px] text-dim">
          No {filter === "all" ? "" : filter} invoices.
        </p>
      ) : (
        <ul className="space-y-2">
          {invoices.map((inv) => {
            const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.canceled;
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">
                      {inv.userLabel || inv.userId}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.fg }}>
                      {st.label}
                    </span>
                  </span>
                  <span className="block text-[11.5px] text-faint">
                    #{inv.id} · {inv.credits} messages · {new Date(inv.createdAt).toLocaleString()}
                  </span>
                </span>
                <span className="text-[14px] font-bold text-ink">{formatAmount(inv.amount, inv.currency)}</span>
                {inv.status === "pending" && (
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy === inv.id}
                      onClick={() => void pay(inv)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-50"
                      style={{ background: "#54d26e" }}
                    >
                      {busy === inv.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Mark paid
                    </button>
                    <button
                      type="button"
                      disabled={busy === inv.id}
                      onClick={() => void cancel(inv)}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-dim disabled:opacity-50"
                      aria-label="Cancel invoice"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
