import { test } from "node:test";
import assert from "node:assert/strict";

const { activityOf, rankActivity } = await import("../../lib/onchain-activity.ts");

const jup = (id, vol, holders, first, holderChange = 0) => ({
  id,
  holderCount: holders,
  firstPool: { createdAt: first },
  stats24h: { buyVolume: vol / 2, sellVolume: vol / 2, numBuys: 10, numSells: 5, numTraders: 7, holderChange },
});

test("onchain: per ticker, every issuer's token added up and ranked by 24h volume; new listings and issuer shares", () => {
  const file = {
    tokens: [
      { ticker: "ANT", name: "Anthropic", symbol: "ANT.US", issuer: "Backpack Securities (Sunrise)", solana_mint: "A1" },
      { ticker: "NVDA", name: "NVIDIA", symbol: "NVDAx", issuer: "xStocks (Backed / Kraken)", solana_mint: "N1" },
      { ticker: "NVDA", name: "NVIDIA", symbol: "NVDA.US", issuer: "Backpack Securities (Sunrise)", solana_mint: "N2" },
      { ticker: "QUIET", name: "Quiet", symbol: "Qx", issuer: "xStocks (Backed / Kraken)", solana_mint: "Q1" },
    ],
  };
  const act = new Map(
    [jup("A1", 60e6, 15000, "2026-11-05T00:00:00Z", 17.1), jup("N1", 30e6, 200000, "2025-06-27T00:00:00Z"), jup("N2", 10e6, 5000, "2026-11-10T00:00:00Z")].map((t) => [t.id, activityOf(t)]),
  );
  const short = (s) => s.split(" ")[0];
  const r = rankActivity(file, act, new Date("2026-11-21T00:00:00Z"), short);
  assert.deepEqual(r.top.map((x) => [x.ticker, x.volume_24h_usd, x.holders]), [["ANT", 60e6, 15000], ["NVDA", 40e6, 205000]]);
  assert.equal(r.top[1].top_issuer, "xStocks");
  assert.deepEqual(r.new_listings.map((x) => x.ticker), ["ANT"], "NVDA is not new: its xStocks token traded long before");
  assert.equal(r.total_volume_24h_usd, 100e6);
  assert.deepEqual(r.by_issuer.map((b) => [b.issuer, b.share]), [["Backpack", 0.7], ["xStocks", 0.3]]);
  assert.equal(r.top[0].holder_change_24h_pct, 17.1);
  assert.equal(r.top[0].trades_24h, 15);
});
