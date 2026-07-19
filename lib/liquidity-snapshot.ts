import {
  getCuratedStocks,
  getMarkets,
  type CuratedItem,
  type Market,
} from "@/lib/tokensXyz";
import { TOKENS_XYZ_SOURCE, type LiquidityFile, type LiquidityPair, type LiquidityPool } from "@/lib/data";

/**
 * Build a full liquidity snapshot from the tokens.xyz Assets API, for the daily
 * update-liquidity cron. Unlike getLiquidity()'s per-request overview (which
 * omits pool depth to stay cheap), this enriches each curated stock with its
 * ranked DEX pools + DEX-vs-listing deviation — the data that makes the
 * liquidity endpoint worth paying for — because a daily batch can afford the
 * per-asset markets calls that a per-request handler cannot.
 *
 * Requires TOKENS_XYZ_API_KEY (getCuratedStocks/getMarkets throw without it).
 * The mapping helpers below are pure so they can be unit-tested without network.
 */

const MAX_POOLS = 5;
/** Below this the DEX/listing gap is noise, not a tradeable dislocation. */
const ARB_THRESHOLD_PCT = 0.25;

/** Ranked DEX pools + the best available DEX price, from a markets response. */
export function marketsToPools(markets: Market[]): {
  pools: LiquidityPool[];
  dexPrice: number;
} {
  const pools: LiquidityPool[] = markets.map((m) => ({
    venue: m.venue ?? m.dex ?? "DEX",
    pair: m.pair ?? m.pairName ?? "",
    tvl_usd: m.tvlUSD ?? m.liquidityUSD ?? 0,
    fee_bps: m.feeBps ?? null,
  }));
  pools.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const dexPrice = markets.find((m) => typeof m.price === "number")?.price ?? 0;
  return { pools: pools.slice(0, MAX_POOLS), dexPrice };
}

/** DEX-rich / DEX-cheap / neutral label from the price deviation. */
export function arbitrageSignal(deviationPct: number): string {
  if (Math.abs(deviationPct) < ARB_THRESHOLD_PCT) return "neutral";
  return deviationPct > 0
    ? "premium (DEX rich vs listing)"
    : "discount (DEX cheap vs listing)";
}

/** Assemble one LiquidityPair from a curated item + its enriched pools. */
export function assemblePair(
  item: CuratedItem,
  pools: LiquidityPool[],
  dexPriceIn: number,
): LiquidityPair {
  const symbol = item.symbol ?? item.asset?.symbol ?? item.assetId ?? "";
  const v = item.primaryVariant;
  const stats = item.stats ?? {};
  const officialPrice = stats.price ?? 0;
  // Fall back to the variant/official price when no pool carried a price.
  const dexPrice = dexPriceIn || v?.market?.price || officialPrice;
  const deviation =
    officialPrice > 0 ? ((dexPrice - officialPrice) / officialPrice) * 100 : 0;
  const tvl =
    pools.reduce((sum, p) => sum + p.tvl_usd, 0) ||
    stats.liquidity ||
    stats.liquidityUSD ||
    0;

  return {
    token_symbol: v?.symbol ?? `${symbol}x`,
    underlying_ticker: symbol,
    official_price_usd: officialPrice,
    dex_price_usd: dexPrice,
    deviation_pct: Number(deviation.toFixed(3)),
    tvl_usd: tvl,
    volume_24h_usd: stats.volume24hUSD ?? v?.market?.volume24hUSD ?? 0,
    top_pools: pools,
    arbitrage_signal: arbitrageSignal(deviation),
  };
}

export interface LiquiditySnapshotResult {
  file: LiquidityFile;
  /** Assets seen in the curated list. */
  universe: number;
  /** Assets whose markets call succeeded (had at least a base row). */
  enriched: number;
}

/**
 * Fetch the curated universe and, for each asset with a mint, its ranked pools,
 * returning a ready-to-persist LiquidityFile. Sequential to respect the API's
 * rate limits (the client already backs off on 429). Per-asset failures are
 * skipped (logged) rather than aborting the whole snapshot.
 */
export async function buildLiquiditySnapshot(): Promise<LiquiditySnapshotResult> {
  const curated = await getCuratedStocks();
  const items = curated?.items ?? curated?.stocks ?? [];

  const pairs: LiquidityPair[] = [];
  let enriched = 0;
  for (const item of items) {
    const mint = item.primaryVariant?.mint;
    const assetId = item.assetId;
    if (!assetId) continue;

    let pools: LiquidityPool[] = [];
    let dexPrice = 0;
    if (mint) {
      try {
        const res = await getMarkets(assetId, mint, { limit: MAX_POOLS });
        const mapped = marketsToPools(res?.markets ?? []);
        pools = mapped.pools;
        dexPrice = mapped.dexPrice;
        enriched += 1;
      } catch (err) {
        console.error(`[update:liquidity] markets(${assetId}) failed:`, err);
      }
    }
    pairs.push(assemblePair(item, pools, dexPrice));
  }

  const file: LiquidityFile = {
    source: TOKENS_XYZ_SOURCE,
    note: "Daily liquidity snapshot: xStock DEX pools + DEX-vs-listing deviation, aggregated by tokens.xyz (Jupiter / Raydium / Orca / Meteora).",
    updated_at: new Date().toISOString(),
    pairs,
  };
  return { file, universe: items.length, enriched };
}
