/**
 * Pure-mapper tests for the daily liquidity snapshot builder. The network
 * orchestration (buildLiquiditySnapshot) is exercised in CI where the
 * tokens.xyz key + egress exist; here we lock down the transforms that turn a
 * tokens.xyz markets/curated response into the committed LiquidityFile shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketsToPools,
  arbitrageSignal,
  assemblePair,
} from "../../lib/liquidity-snapshot.ts";

test("marketsToPools: ranks by TVL, caps at 5, picks a DEX price", () => {
  const markets = [
    { venue: "Orca", pair: "TSLAx/USDC", tvlUSD: 100, price: 250.5 },
    { dex: "Raydium", pairName: "TSLAx/USDC", liquidityUSD: 900 },
    { venue: "Meteora", tvlUSD: 500, feeBps: 30 },
    { venue: "A", tvlUSD: 1 },
    { venue: "B", tvlUSD: 2 },
    { venue: "C", tvlUSD: 3 },
  ];
  const { pools, dexPrice } = marketsToPools(markets);
  assert.equal(pools.length, 5, "capped at MAX_POOLS");
  assert.equal(pools[0].tvl_usd, 900, "highest TVL first");
  assert.equal(pools[0].venue, "Raydium", "dex used when venue missing");
  assert.equal(dexPrice, 250.5, "first numeric price wins");
  // Sorted by TVL desc: 900, 500(fee 30), 100(Orca, no fee → null), 3, 2.
  assert.equal(pools[1].fee_bps, 30, "fee carried through");
  assert.equal(pools[2].fee_bps, null, "missing fee → null");
});

test("marketsToPools: empty markets → no pools, zero price", () => {
  const { pools, dexPrice } = marketsToPools([]);
  assert.deepEqual(pools, []);
  assert.equal(dexPrice, 0);
});

test("arbitrageSignal: threshold + direction", () => {
  assert.equal(arbitrageSignal(0.1), "neutral");
  assert.equal(arbitrageSignal(-0.1), "neutral");
  assert.equal(arbitrageSignal(1.5), "premium (DEX rich vs listing)");
  assert.equal(arbitrageSignal(-1.5), "discount (DEX cheap vs listing)");
});

test("assemblePair: computes deviation, tvl from pools, signal", () => {
  const item = {
    assetId: "tsla",
    symbol: "TSLA",
    stats: { price: 100, volume24hUSD: 5000 },
    primaryVariant: { symbol: "TSLAx", mint: "mint1", market: { price: 0 } },
  };
  const pools = [
    { venue: "Orca", pair: "TSLAx/USDC", tvl_usd: 700, fee_bps: 30 },
    { venue: "Raydium", pair: "TSLAx/USDC", tvl_usd: 300, fee_bps: null },
  ];
  const pair = assemblePair(item, pools, 103);
  assert.equal(pair.underlying_ticker, "TSLA");
  assert.equal(pair.token_symbol, "TSLAx");
  assert.equal(pair.official_price_usd, 100);
  assert.equal(pair.dex_price_usd, 103);
  assert.equal(pair.deviation_pct, 3); // (103-100)/100*100
  assert.equal(pair.tvl_usd, 1000); // summed from pools
  assert.equal(pair.arbitrage_signal, "premium (DEX rich vs listing)");
  assert.equal(pair.top_pools.length, 2);
});

test("assemblePair: no pool price falls back to variant/official, no div-by-zero", () => {
  const item = {
    assetId: "x",
    symbol: "X",
    stats: { price: 0, liquidity: 42 },
    primaryVariant: { symbol: "Xx", market: { price: 0 } },
  };
  const pair = assemblePair(item, [], 0);
  assert.equal(pair.dex_price_usd, 0); // 0 || 0 || 0
  assert.equal(pair.deviation_pct, 0); // official 0 → guarded
  assert.equal(pair.tvl_usd, 42); // falls back to stats.liquidity
  assert.equal(pair.arbitrage_signal, "neutral");
});
