/**
 * Token economy — pure wallet arithmetic (earn on contribution, spend to peek).
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  STARTING_BALANCE,
  BUY_TOKENS_AMOUNT,
  PROMOTION_REWARD,
  PROMOTION_PER_SUPPORTER,
  PEEK_BASE_COST,
  PEEK_RADIUS_STEP,
  promotionReward,
  peekCost,
  ensureWallet,
  spendTokens,
  earnTokens,
  buyTokens,
} from "../src/index.ts";
import type { Dataset } from "../src/index.ts";

const base = (): Dataset => ({
  nodes: [],
  links: [],
  meId: "me",
  recommendations: [],
  wallet: { balance: 20, earnedTotal: 0, ledger: [] },
});

test("promotionReward: base at threshold, +per extra supporter", () => {
  assert.equal(promotionReward(2, 2), PROMOTION_REWARD);
  assert.equal(promotionReward(1, 2), PROMOTION_REWARD); // never negative
  assert.equal(promotionReward(4, 2), PROMOTION_REWARD + 2 * PROMOTION_PER_SUPPORTER);
});

test("peekCost: base + per-extra-hop + capped size surcharge", () => {
  assert.equal(peekCost(1), PEEK_BASE_COST);
  assert.equal(peekCost(3), PEEK_BASE_COST + 2 * PEEK_RADIUS_STEP);
  assert.equal(peekCost(1, 120), PEEK_BASE_COST + 6); // surcharge capped at 6
});

test("spendTokens deducts, and throws when the wallet can't cover it", () => {
  assert.equal(spendTokens(base(), 6, "peek").wallet!.balance, 14);
  assert.throws(() => spendTokens(base(), 999), /Not enough/);
});

test("earnTokens credits balance + earnedTotal; buys don't count as earned", () => {
  const e = earnTokens(base(), 3, "thought");
  assert.equal(e.wallet!.balance, 23);
  assert.equal(e.wallet!.earnedTotal, 3);

  const b = buyTokens(base());
  assert.equal(b.wallet!.balance, 20 + BUY_TOKENS_AMOUNT);
  assert.equal(b.wallet!.earnedTotal, 0);

  assert.equal(earnTokens(base(), 0, "thought").wallet!.balance, 20); // no-op for ≤ 0
});

test("ensureWallet materializes the starting allowance when absent", () => {
  const w = ensureWallet({ nodes: [], links: [], meId: "me", recommendations: [] });
  assert.equal(w.balance, STARTING_BALANCE);
  assert.equal(w.earnedTotal, 0);
});
