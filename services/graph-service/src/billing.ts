/**
 * Chat credits + billing (pay-as-you-go, manual settlement for now).
 *
 * Model — deliberately explainable: **1 AI message = 1 credit**. Users can
 * count what they have left; tokens can't be reasoned about by a human.
 *
 * Balance rides the SAME append-only `credits_ledger` as the rest of the
 * economy (credits.ts), so three sources stack naturally:
 *   • a free monthly allowance (granted lazily, once per calendar month)
 *   • credits EARNED from validated contribution (derived, never stored)
 *   • purchased packs (granted when an invoice is marked paid)
 * Every movement stays auditable — the product's founding rule for credits.
 *
 * Payment is manual in v1: the user picks a pack → we issue an invoice →
 * they pay a human (WhatsApp number configured in admin settings) → an admin
 * marks it paid, which grants the credits. A gateway can replace only the
 * `markInvoicePaid` trigger later; nothing else changes.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export interface Plan {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  /** Marketing label, e.g. "Most popular". */
  tag?: string;
}

/** Packs + the free tier. Env-tunable; no pricing hardcoded in logic. */
export const BILLING_CONFIG = {
  /** Free AI messages granted at the start of each calendar month. */
  freeMonthly: Math.max(0, Number(process.env.CHAT_FREE_MONTHLY ?? 30) || 30),
  /** Credits charged per agent turn. */
  costPerMessage: Math.max(1, Number(process.env.CHAT_COST_PER_MESSAGE ?? 1) || 1),
  currency: (process.env.BILLING_CURRENCY ?? "AMD").toUpperCase(),
  plans: [
    { id: "starter", credits: 100, amount: Number(process.env.PLAN_STARTER_AMD ?? 3000) || 3000 },
    { id: "plus", credits: 300, amount: Number(process.env.PLAN_PLUS_AMD ?? 7000) || 7000, tag: "popular" },
    { id: "pro", credits: 1000, amount: Number(process.env.PLAN_PRO_AMD ?? 20000) || 20000 },
  ],
};

export function plans(): Plan[] {
  return BILLING_CONFIG.plans.map((p) => ({ ...p, currency: BILLING_CONFIG.currency }));
}
export const planById = (id: string): Plan | undefined => plans().find((p) => p.id === id);

export function billingEnabled(): boolean {
  return !!pool;
}

export async function initBilling(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — billing disabled (chat unmetered)");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      user_label TEXT,
      plan_id    TEXT NOT NULL,
      credits    INTEGER NOT NULL,
      amount     INTEGER NOT NULL,
      currency   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at    TIMESTAMPTZ,
      paid_by    TEXT
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS invoices_user_idx ON invoices(user_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status, created_at DESC)`);
  pool = p;
  console.log("graph-service: billing ready (postgres)");
}

/* ----------------------------- allowance ----------------------------- */

/** Calendar-month key, e.g. "2026-08" — one allowance grant per user per month. */
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Grant this month's free messages if the user hasn't received them yet.
 * Idempotent under concurrency: the guard is a NOT EXISTS inside the INSERT,
 * so two simultaneous turns can't double-grant.
 */
export async function ensureMonthlyAllowance(userId: string): Promise<void> {
  if (!pool || BILLING_CONFIG.freeMonthly <= 0) return;
  const month = monthKey();
  await pool.query(
    `INSERT INTO credits_ledger (user_id, delta, reason, detail)
     SELECT $1, $2, 'monthly_allowance', $3
      WHERE NOT EXISTS (
        SELECT 1 FROM credits_ledger
         WHERE user_id = $1 AND reason = 'monthly_allowance' AND detail->>'month' = $4
      )`,
    [userId, BILLING_CONFIG.freeMonthly, JSON.stringify({ month }), month],
  );
}

/* ------------------------------ metering ----------------------------- */

export type SpendResult =
  | { ok: true; balance: number }
  | { ok: false; reason: "insufficient"; balance: number };

/**
 * Charge one AI message. `earned` (contribution-derived credits) is passed in
 * by the caller and folded into the atomic guard, exactly like spendForBoost —
 * check-and-write in ONE statement so parallel turns can't overdraw.
 */
export async function spendForMessage(
  userId: string,
  earned: number,
  detail: Record<string, unknown> = {},
): Promise<SpendResult> {
  if (!pool) return { ok: true, balance: Number.POSITIVE_INFINITY }; // unmetered without a DB
  const cost = BILLING_CONFIG.costPerMessage;
  const r = await pool.query(
    `INSERT INTO credits_ledger (user_id, delta, reason, detail)
     SELECT $1, $2, 'chat_message', $3
      WHERE (SELECT COALESCE(SUM(delta), 0) FROM credits_ledger WHERE user_id = $1) + $4 >= $5
     RETURNING id`,
    [userId, -cost, JSON.stringify(detail), earned, cost],
  );
  const balance = await chatBalance(userId, earned);
  return r.rows[0] ? { ok: true, balance } : { ok: false, reason: "insufficient", balance };
}

/** Spendable balance = contribution-earned + ledger net (never negative). */
export async function chatBalance(userId: string, earned: number): Promise<number> {
  if (!pool) return Number.POSITIVE_INFINITY;
  const r = await pool.query(
    `SELECT COALESCE(SUM(delta), 0) AS s FROM credits_ledger WHERE user_id = $1`,
    [userId],
  );
  return Math.max(0, Number(r.rows[0]?.s ?? 0) + earned);
}

/** Messages used this calendar month (for the usage meter). */
export async function messagesUsedThisMonth(userId: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT COALESCE(SUM(-delta), 0) AS s FROM credits_ledger
      WHERE user_id = $1 AND reason = 'chat_message'
        AND created_at >= date_trunc('month', now())`,
    [userId],
  );
  return Math.round(Number(r.rows[0]?.s ?? 0));
}

/* ------------------------------ invoices ----------------------------- */

export interface Invoice {
  id: number;
  userId: string;
  userLabel?: string;
  planId: string;
  credits: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "canceled";
  note?: string;
  createdAt: string;
  paidAt?: string;
}

const rowToInvoice = (row: Record<string, unknown>): Invoice => ({
  id: Number(row.id),
  userId: String(row.user_id),
  userLabel: row.user_label ? String(row.user_label) : undefined,
  planId: String(row.plan_id),
  credits: Number(row.credits),
  amount: Number(row.amount),
  currency: String(row.currency),
  status: String(row.status) as Invoice["status"],
  note: row.note ? String(row.note) : undefined,
  createdAt: new Date(row.created_at as string).toISOString(),
  paidAt: row.paid_at ? new Date(row.paid_at as string).toISOString() : undefined,
});

/** Issue an invoice for a pack. Reuses the user's open invoice for the same
 *  plan instead of piling up duplicates when they tap twice. */
export async function createInvoice(
  userId: string,
  userLabel: string,
  plan: Plan,
): Promise<Invoice> {
  if (!pool) throw new Error("billing disabled");
  const existing = await pool.query(
    `SELECT * FROM invoices WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
      ORDER BY id DESC LIMIT 1`,
    [userId, plan.id],
  );
  if (existing.rows[0]) return rowToInvoice(existing.rows[0]);
  const r = await pool.query(
    `INSERT INTO invoices (user_id, user_label, plan_id, credits, amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, userLabel.slice(0, 120), plan.id, plan.credits, plan.amount, plan.currency],
  );
  return rowToInvoice(r.rows[0]);
}

export async function listInvoices(userId: string, limit = 20): Promise<Invoice[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM invoices WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map(rowToInvoice);
}

export async function getInvoice(id: number, userId?: string): Promise<Invoice | null> {
  if (!pool) return null;
  const r = userId
    ? await pool.query(`SELECT * FROM invoices WHERE id = $1 AND user_id = $2`, [id, userId])
    : await pool.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
  return r.rows[0] ? rowToInvoice(r.rows[0]) : null;
}

/** Admin view: newest first, optionally filtered by status. */
export async function allInvoices(status?: string, limit = 100): Promise<Invoice[]> {
  if (!pool) return [];
  const r = status
    ? await pool.query(`SELECT * FROM invoices WHERE status = $1 ORDER BY id DESC LIMIT $2`, [status, limit])
    : await pool.query(`SELECT * FROM invoices ORDER BY id DESC LIMIT $1`, [limit]);
  return r.rows.map(rowToInvoice);
}

/**
 * Mark an invoice paid and grant its credits — one transaction, and the
 * status guard is in the UPDATE, so double-clicking "mark paid" can never
 * grant twice.
 */
export async function markInvoicePaid(id: number, adminId: string): Promise<Invoice | null> {
  if (!pool) throw new Error("billing disabled");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE invoices SET status = 'paid', paid_at = now(), paid_by = $2
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, adminId],
    );
    if (!upd.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const inv = rowToInvoice(upd.rows[0]);
    await client.query(
      `INSERT INTO credits_ledger (user_id, delta, reason, detail) VALUES ($1, $2, 'purchase', $3)`,
      [inv.userId, inv.credits, JSON.stringify({ invoiceId: inv.id, planId: inv.planId, by: adminId })],
    );
    await client.query("COMMIT");
    return inv;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelInvoice(id: number, userId?: string): Promise<boolean> {
  if (!pool) return false;
  const r = userId
    ? await pool.query(
        `UPDATE invoices SET status = 'canceled' WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
        [id, userId],
      )
    : await pool.query(
        `UPDATE invoices SET status = 'canceled' WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id],
      );
  return !!r.rows[0];
}
