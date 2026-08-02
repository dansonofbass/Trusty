"use client";

/**
 * The paywall: shown when a chat turn is refused for lack of credits (HTTP
 * 402 from the agent stream). Three states in one sheet — pick a pack, then
 * the invoice with a WhatsApp "pay" button, then a receipt-pending note.
 * Fully translated (fa/en) since this is a newcomer-path surface.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, MessageCircle, Sparkles, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  createInvoice, formatAmount, whatsappLink,
  type Invoice, type PaymentContact, type Plan,
} from "@/lib/billingClient";

export default function CreditsPaywall({
  plans,
  payment,
  freeMonthly,
  onClose,
}: {
  plans: Plan[];
  payment: PaymentContact;
  freeMonthly?: number;
  onClose: () => void;
}) {
  const t = useT();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [contact, setContact] = useState<PaymentContact>(payment);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (plan: Plan) => {
    setBusy(plan.id);
    setError(null);
    try {
      const r = await createInvoice(plan.id);
      setInvoice(r.invoice);
      setContact(r.payment);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  const wa = invoice ? whatsappLink(contact, invoice) : null;

  // The chip that opens this lives inside the sidebar, which has a
  // backdrop-filter — that makes it a containing block for `position: fixed`,
  // so the sheet would be centred on the SIDEBAR (and clipped off-screen).
  // Portalling to <body> is the fix.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 pb-[max(env(safe-area-inset-bottom),16px)] md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[460px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[14px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              <Sparkles size={15} style={{ color: "var(--color-accent)" }} />
              {invoice ? t("credits.invoiceNumber", { id: invoice.id }) : t("credits.outOfCredits")}
            </div>
            {!invoice && (
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-dim)]">
                {t("credits.outOfCreditsBody")}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t("credits.close")} className="grid h-8 w-8 shrink-0 place-items-center">
            <X size={16} className="text-[var(--color-faint)]" />
          </button>
        </div>

        {!invoice ? (
          <>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]">
              {t("credits.choosePlan")}
            </div>
            <div className="space-y-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-start transition disabled:opacity-50"
                  style={p.tag
                    ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                    : { borderColor: "var(--color-line)" }}
                >
                  <span>
                    <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
                      <MessageCircle size={13} /> {t("credits.messages", { count: p.credits })}
                    </span>
                    <span className="text-[11px] text-[var(--color-faint)]">
                      {formatAmount(Math.round(p.amount / p.credits), p.currency)} / {t("credits.messages", { count: 1 })}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold"
                    style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}>
                    {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : formatAmount(p.amount, p.currency)}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-[var(--color-line)] p-3">
              <div className="text-[12px] font-bold text-ink">{t("credits.earnFree")}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-dim)]">{t("credits.earnFreeBody")}</p>
              {!!freeMonthly && (
                <p className="mt-1 text-[11px] text-[var(--color-faint)]">{t("credits.freeMonthly", { count: freeMonthly })}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-[var(--color-line)] p-3.5">
              <div className="flex items-center justify-between text-[13px] text-ink">
                <span>{t("credits.messages", { count: invoice.credits })}</span>
                <span className="font-bold">{formatAmount(invoice.amount, invoice.currency)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line)] pt-2 text-[12px]">
                <span className="text-[var(--color-faint)]">{t("credits.amountDue")}</span>
                <span className="font-bold" style={{ color: "var(--color-accent)" }}>
                  {formatAmount(invoice.amount, invoice.currency)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-dim)]">
              {wa ? t("credits.payInstructions") : t("credits.contactAdmin")}
            </p>
            {contact.note && (
              <p dir="auto" className="mt-1.5 rounded-lg bg-[var(--color-tint)] px-3 py-2 text-[11.5px] text-[var(--color-dim)]">
                {contact.note}
              </p>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block w-full rounded-xl py-3 text-center text-[13.5px] font-bold"
                style={{ background: "#25D366", color: "#08210f" }}
              >
                {t("credits.payViaWhatsapp")}
              </a>
            )}
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
              <Check size={12} /> {t("credits.pending")}
            </p>
          </>
        )}

        {error && <p className="mt-2 text-[11.5px] text-[#fda4af]">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
