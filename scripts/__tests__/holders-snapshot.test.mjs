/**
 * Pure-mapper tests for the daily holders snapshot builder. Network
 * orchestration (buildHoldersSnapshot) runs in CI where the Birdeye key +
 * egress exist; here we lock the transforms that turn Birdeye holder/overview
 * responses into the committed HoldersFile shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holderUiAmount,
  overviewSupply,
  overviewHolderCount,
  toHolderEntries,
  concentration,
  assembleHoldersToken,
} from "../../lib/holders-snapshot.ts";

test("holderUiAmount: prefers ui_amount, then uiAmount, then amount/decimals", () => {
  assert.equal(holderUiAmount({ ui_amount: 42 }), 42);
  assert.equal(holderUiAmount({ uiAmount: 7 }), 7);
  assert.equal(holderUiAmount({ amount: "1000", decimals: 2 }), 10);
  assert.equal(holderUiAmount({ amount: 5 }), 5);
  assert.equal(holderUiAmount({}), 0);
});

test("overviewSupply / overviewHolderCount: field fallbacks + null-safe", () => {
  assert.equal(overviewSupply({ circulatingSupply: 100, supply: 200 }), 100);
  assert.equal(overviewSupply({ supply: 200 }), 200);
  assert.equal(overviewSupply(null), 0);
  assert.equal(overviewHolderCount({ holder: 4218 }), 4218);
  assert.equal(overviewHolderCount({ holders: 9 }), 9);
  assert.equal(overviewHolderCount(null), 0);
});

test("toHolderEntries: ranks desc, computes pct, drops empty, tolerates owner variants", () => {
  const items = [
    { owner: "A", ui_amount: 100 },
    { address: "B", ui_amount: 300 },
    { token_account: "C", amount: "50", decimals: 0 },
    { owner: "", ui_amount: 999 }, // no address → dropped
    { owner: "D", ui_amount: 0 }, // zero balance → dropped
  ];
  const entries = toHolderEntries(items, 1000);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].address, "B");
  assert.equal(entries[0].rank, 1);
  assert.equal(entries[0].balance, 300);
  assert.equal(entries[0].pct, 30); // 300/1000
  assert.equal(entries[2].address, "C");
});

test("toHolderEntries: zero supply → pct 0, no div-by-zero", () => {
  const entries = toHolderEntries([{ owner: "A", ui_amount: 5 }], 0);
  assert.equal(entries[0].pct, 0);
});

test("concentration: top-10 share → score + label", () => {
  const mk = (pcts) => pcts.map((pct, i) => ({ rank: i + 1, address: `a${i}`, balance: 0, pct, label: "" }));
  assert.deepEqual(concentration(mk([15, 12, 9, 6])), { score: 0.42, label: "moderate" });
  assert.deepEqual(concentration(mk([5, 4, 3])), { score: 0.12, label: "low" });
  assert.deepEqual(concentration(mk([40, 30])), { score: 0.7, label: "high" });
});

test("assembleHoldersToken: full shape, symbol normalized to xStock", () => {
  const token = assembleHoldersToken({
    symbol: "nvda",
    mint: "Xsc9...qEh",
    holders: [
      { owner: "A", ui_amount: 150000 },
      { owner: "B", ui_amount: 90000 },
    ],
    overview: { circulatingSupply: 600000, holder: 4218 },
  });
  assert.equal(token.token_symbol, "NVDAx");
  assert.equal(token.underlying_ticker, "NVDA");
  assert.equal(token.mint_address, "Xsc9...qEh");
  assert.equal(token.holder_count, 4218);
  assert.equal(token.total_supply, 600000);
  assert.equal(token.top_holders[0].pct, 25); // 150000/600000
  assert.equal(token.concentration_label, "moderate"); // (25+15)/100 = 0.4
  assert.equal(token.top_holders.length, 2);
});

test("assembleHoldersToken: already-x symbol not double-suffixed", () => {
  const token = assembleHoldersToken({
    symbol: "TSLAX",
    mint: "m",
    holders: [{ owner: "A", ui_amount: 1 }],
    overview: { supply: 10, holder: 1 },
  });
  assert.equal(token.token_symbol, "TSLAX");
});
