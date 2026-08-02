/** Chat credits + billing — thin fetchers over the BFF proxies. */

export interface Plan {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  tag?: string;
}

export interface Invoice {
  id: number;
  userId: string;
  userLabel?: string;
  planId: string;
  credits: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "canceled";
  createdAt: string;
  paidAt?: string;
}

export interface PaymentContact {
  whatsapp: string;
  note: string;
}

export interface BillingMe {
  enabled: boolean;
  balance: number;
  usedThisMonth: number;
  freeMonthly: number;
  costPerMessage: number;
  earned: number;
  plans: Plan[];
  payment: PaymentContact;
  invoices: Invoice[];
}

/** The 402 payload the chat paywall renders. */
export interface QuotaExceeded {
  error: "insufficient_credits";
  balance: number;
  plans: Plan[];
  payment: PaymentContact;
}

async function json<T>(r: Response): Promise<T> {
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b as { error?: string })?.error ?? `request failed (${r.status})`);
  return b as T;
}

export const getBilling = (): Promise<BillingMe> => fetch("/api/billing/me").then((r) => json(r));

export const createInvoice = (planId: string): Promise<{ invoice: Invoice; payment: PaymentContact }> =>
  fetch("/api/billing/invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId }),
  }).then((r) => json(r));

export const getInvoice = (id: number): Promise<{ invoice: Invoice; payment: PaymentContact }> =>
  fetch(`/api/billing/invoices/${id}`).then((r) => json(r));

/* admin */
export const adminInvoices = (status?: string): Promise<{ invoices: Invoice[]; plans: Plan[] }> =>
  fetch(`/api/admin/invoices${status ? `?status=${encodeURIComponent(status)}` : ""}`).then((r) => json(r));

export const adminPayInvoice = (id: number): Promise<{ invoice: Invoice }> =>
  fetch(`/api/admin/invoices/${id}/pay`, { method: "POST" }).then((r) => json(r));

export const adminCancelInvoice = (id: number): Promise<{ ok: boolean }> =>
  fetch(`/api/admin/invoices/${id}/cancel`, { method: "POST" }).then((r) => json(r));

export const adminSavePayment = (whatsapp: string, note: string): Promise<PaymentContact> =>
  fetch("/api/admin/settings/payment", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ whatsapp, note }),
  }).then((r) => json(r));

/** Money as the community reads it: "3,000 AMD". */
export const formatAmount = (amount: number, currency: string): string =>
  `${amount.toLocaleString()} ${currency}`;

/** Prefilled WhatsApp deep link for an invoice. */
export function whatsappLink(payment: PaymentContact, invoice: Invoice): string | null {
  const num = (payment.whatsapp ?? "").replace(/[^\d]/g, "");
  if (!num) return null;
  const text = `Trusty invoice #${invoice.id} — ${invoice.credits} messages, ${formatAmount(invoice.amount, invoice.currency)}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
