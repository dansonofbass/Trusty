import type { Dataset, Wallet, WalletEntry } from "./types";

/**
 * Token economy — the scarcity that gates exploration.
 *
 * You see only your social galaxy by default (see `visibleIds` in analytics).
 * To peek beyond it you SPEND tokens; to refill you EARN them by contributing
 * to the shared graph. The two earning hooks live in the pure mutation
 * functions so they fire identically in mock and api modes:
 *   - writing a thought            → `THOUGHT_REWARD`        (extract.ts)
 *   - your link admitted to global → `promotionReward(...)`  (entityLinks.ts)
 *
 * `promotionReward` scales with supporter count. In a single-user prototype
 * that's a consensus proxy; once the platform is multi-user, supporter count
 * IS the adoption count — real "how many people used what you added" reward
 * slots in here with no call-site change.
 */

export const STARTING_BALANCE = 20;
export const BUY_TOKENS_AMOUNT = 10;
export const THOUGHT_REWARD = 3;
export const PROMOTION_REWARD = 8;
export const PROMOTION_PER_SUPPORTER = 4;
export const PEEK_BASE_COST = 6;
export const PEEK_RADIUS_STEP = 4;

const LEDGER_CAP = 20;

/** Supporters at/below threshold earn the base; extra adopters scale it up. */
export function promotionReward(supporters: number, threshold = 2): number {
  return PROMOTION_REWARD + Math.max(0, supporters - threshold) * PROMOTION_PER_SUPPORTER;
}

/**
 * Cost of a peek given its radius (and optionally the size of the region it
 * reveals). Base + per-extra-hop + a small surcharge so peeking into a hub
 * costs a little more, capped to stay predictable.
 */
export function peekCost(radius: number, regionSize = 0): number {
  const sizeSurcharge = Math.min(6, Math.floor(regionSize / 12));
  return PEEK_BASE_COST + Math.max(0, radius - 1) * PEEK_RADIUS_STEP + sizeSurcharge;
}

/** The viewer's wallet, lazily materialized with the starting allowance. */
export function ensureWallet(d: Dataset): Wallet {
  return d.wallet ?? { balance: STARTING_BALANCE, earnedTotal: 0, ledger: [] };
}

function applyDelta(w: Wallet, e: WalletEntry): Wallet {
  const earned = e.delta > 0 && e.reason !== "buy" ? e.delta : 0;
  return {
    balance: w.balance + e.delta,
    earnedTotal: w.earnedTotal + earned,
    ledger: [...(w.ledger ?? []), e].slice(-LEDGER_CAP),
  };
}

/** Deduct tokens; throws if the wallet can't cover the amount. */
export function spendTokens(
  d: Dataset,
  amount: number,
  reason: WalletEntry["reason"] = "peek",
  ref?: string,
): Dataset {
  const w = ensureWallet(d);
  if (amount > w.balance) throw new Error("Not enough tokens");
  return { ...d, wallet: applyDelta(w, { delta: -amount, reason, at: Date.now(), ref }) };
}

/** Credit tokens earned through contribution (no-op for amount ≤ 0). */
export function earnTokens(
  d: Dataset,
  amount: number,
  reason: WalletEntry["reason"],
  ref?: string,
): Dataset {
  if (amount <= 0) return d;
  const w = ensureWallet(d);
  return { ...d, wallet: applyDelta(w, { delta: amount, reason, at: Date.now(), ref }) };
}

/** Top up the wallet (dev/prototype affordance standing in for a purchase). */
export function buyTokens(d: Dataset, amount = BUY_TOKENS_AMOUNT): Dataset {
  const w = ensureWallet(d);
  return { ...d, wallet: applyDelta(w, { delta: amount, reason: "buy", at: Date.now() }) };
}
