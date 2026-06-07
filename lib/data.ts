import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isTokensXyzEnabled,
  getCuratedStocks,
  resolveAsset,
  getVariants,
  getMarkets,
  type CuratedItem,
  type TokensXyzVariant,
} from "@/lib/tokensXyz";

const DATA_DIR = path.join(process.cwd(), "data");

async function loadJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
  return JSON.parse(raw) as T;
}

export type Venue = string;

export interface TokenizedVersion {
  issuer: string;
  token_symbol: string;
  chain: string;
  mint_address: string;
  decimals: number;
  current_price_usd: number;
  volume_24h_usd: number;
  venues: Venue[];
}

export interface Stock {
  underlying_ticker: string;
  company_name: string;
  listing_market: string;
  market_cap_usd: number;
  price_usd: number;
  price_change_24h_pct: number;
  price_change_7d_pct: number;
  price_change_30d_pct: number;
  volume_24h_usd: number;
  earnings_next_date: string | null;
  tokenized_versions: TokenizedVersion[];
}

export interface StocksFile {
  source: string;
  note: string;
  updated_at: string;
  stocks: Stock[];
}

export interface IpoPlatform {
  platform: string;
  partner: string;
  status: string;
  url: string;
}

export interface Ipo {
  ticker: string;
  company_name: string;
  sector: string;
  planned_listing_date: string;
  target_listing_market: string;
  primary_issuance_platforms: IpoPlatform[];
}

export interface IposFile {
  source: string;
  note: string;
  updated_at: string;
  ipos: Ipo[];
}

export interface LiquidityPool {
  venue: string;
  pair: string;
  tvl_usd: number;
  fee_bps: number | null;
}

export interface LiquidityPair {
  token_symbol: string;
  underlying_ticker: string;
  official_price_usd: number;
  dex_price_usd: number;
  deviation_pct: number;
  tvl_usd: number;
  volume_24h_usd: number;
  top_pools: LiquidityPool[];
  arbitrage_signal: string;
}

export interface LiquidityFile {
  source: string;
  note: string;
  updated_at: string;
  pairs: LiquidityPair[];
}

export interface HolderEntry {
  rank: number;
  address: string;
  balance: number;
  pct: number;
  label: string;
}

export interface HoldersToken {
  token_symbol: string;
  underlying_ticker: string;
  mint_address: string;
  holder_count: number;
  total_supply: number;
  concentration_score: number;
  concentration_label: string;
  top_holders: HolderEntry[];
}

export interface HoldersFile {
  source: string;
  note: string;
  updated_at: string;
  tokens: HoldersToken[];
}

export interface AlphaPost {
  url: string;
  added_at: string;
}

export interface PortfolioHolding {
  ticker: string;
  company_name: string;
  weight: number;
  thesis: string;
  entry_price_usd?: number;
  current_price_usd?: number;
}

export interface PortfolioChange {
  ticker: string;
  action: "add" | "remove" | "increase" | "decrease" | "hold";
  from_weight?: number;
  to_weight?: number;
}

export interface Portfolio {
  week_of: string;
  generated_at: string;
  model: string;
  horizon: string;
  rationale: string;
  holdings: PortfolioHolding[];
  changes?: PortfolioChange[];
}

export interface PortfolioHistoryFile {
  source: string;
  note: string;
  updated_at: string;
  current: Portfolio | null;
  history: Portfolio[];
}

export interface PerformanceRecord {
  date: string;
  portfolio_index: number;
  spy_index: number;
  qqq_index: number;
  portfolio_return_pct: number;
  spy_return_pct: number;
  qqq_return_pct: number;
}

export type EvaluationStatus =
  | "pending"
  | "hit"
  | "partial"
  | "miss"
  | "na";

export interface PortfolioEvaluation {
  week_of: string;
  ticker: string;
  catalyst_target_date: string;
  success_condition: string;
  status: EvaluationStatus;
  evaluated_at: string | null;
  evidence_url: string | null;
  reasoning: string | null;
}

export interface PortfolioEvaluationsFile {
  source: string;
  note: string;
  updated_at: string;
  evaluations: PortfolioEvaluation[];
}

/**
 * Externally-submitted catalyst (Phase A). Same status vocabulary as the
 * internal portfolio evaluations, judged by the same daily evaluator.
 */
export interface ExternalCatalyst {
  catalyst_id: string;
  ticker: string;
  catalyst_description: string;
  target_date: string;
  submitted_at: string;
  submitter_contact: string | null;
  status: EvaluationStatus;
  judgement_date: string | null;
  evidence_urls: string[];
  reasoning: string | null;
}

export interface PerformanceHistoryFile {
  source: string;
  note: string;
  updated_at: string;
  base_date: string;
  base_spy_price?: number;
  base_qqq_price?: number;
  records: PerformanceRecord[];
}

// ── JSON fallback loaders ──────────────────────────────────────────────
// Used when TOKENS_XYZ_API_KEY is unset, or when a tokens.xyz call fails.

const loadStocksJson = () => loadJson<StocksFile>("stocks.json");
const loadLiquidityJson = () => loadJson<LiquidityFile>("liquidity.json");

export const getIpos = () => loadJson<IposFile>("ipo.json");
export const getHolders = () => loadJson<HoldersFile>("holders.json");
export const getAlphaPosts = () => loadJson<AlphaPost[]>("alpha-posts.json");
export const getPortfolioHistory = () =>
  loadJson<PortfolioHistoryFile>("portfolio-history.json");
export const getPerformanceHistory = () =>
  loadJson<PerformanceHistoryFile>("performance-history.json");
export const getPortfolioEvaluations = () =>
  loadJson<PortfolioEvaluationsFile>("portfolio-evaluations.json");
export const getExternalCatalysts = () =>
  loadJson<ExternalCatalyst[]>("external-catalysts.json");

// ── tokens.xyz → existing-shape mappers ────────────────────────────────

const TOKENS_XYZ_SOURCE = "tokens.xyz Assets API";

/** Map a variant's tags to an issuer label, preserving the existing string. */
function issuerFromVariant(v: TokensXyzVariant): string {
  const tags = v.tags ?? [];
  if (tags.includes("xStock")) return "Backed Finance (xStocks)";
  if (tags.includes("Ondo")) return "Ondo Finance";
  if (tags.includes("PreStocks")) return "PreStocks";
  return v.label ?? "tokens.xyz";
}

/** venues are derived from the variant tags (xStock / Ondo / PreStocks). */
function venuesFromVariant(v: TokensXyzVariant): Venue[] {
  if (v.tags && v.tags.length > 0) return v.tags;
  if (v.label) return [v.label];
  return [];
}

function variantToTokenized(
  v: TokensXyzVariant,
  fallbackSymbol: string,
  fallbackPrice: number,
  fallbackVolume: number,
): TokenizedVersion {
  return {
    issuer: issuerFromVariant(v),
    token_symbol: v.symbol ?? `${fallbackSymbol}x`,
    chain: v.chain ?? "Solana",
    mint_address: v.mint ?? "",
    decimals: v.decimals ?? 8,
    current_price_usd: v.market?.price ?? fallbackPrice,
    volume_24h_usd: v.market?.volume24hUSD ?? fallbackVolume,
    venues: venuesFromVariant(v),
  };
}

function curatedItemToStock(item: CuratedItem): Stock {
  const symbol = item.symbol ?? item.asset?.symbol ?? item.assetId ?? "";
  const stats = item.stats ?? {};
  const price = stats.price ?? 0;
  const volume = stats.volume24hUSD ?? 0;
  const tokenized: TokenizedVersion[] = item.primaryVariant
    ? [variantToTokenized(item.primaryVariant, symbol, price, volume)]
    : [];
  return {
    underlying_ticker: symbol,
    company_name: item.name ?? item.asset?.name ?? symbol,
    listing_market: item.listingMarket ?? item.exchange ?? "",
    market_cap_usd: stats.marketCap ?? 0,
    price_usd: price,
    price_change_24h_pct: stats.priceChange24hPct ?? stats["24h"] ?? 0,
    price_change_7d_pct: 0,
    price_change_30d_pct: 0,
    volume_24h_usd: volume,
    earnings_next_date: null,
    tokenized_versions: tokenized,
  };
}

// ── Public getters (tokens.xyz-backed with JSON fallback) ──────────────

/** Full registry. Sourced from tokens.xyz curated stocks when enabled. */
export async function getStocks(): Promise<StocksFile> {
  if (!isTokensXyzEnabled()) return loadStocksJson();
  try {
    const curated = await getCuratedStocks();
    const items = curated?.items ?? curated?.stocks ?? [];
    if (items.length === 0) return loadStocksJson();
    return {
      source: TOKENS_XYZ_SOURCE,
      note: "Solana tokenized-equity resolution and liquidity ranking served by tokens.xyz (xStock + Ondo + PreStocks).",
      updated_at: new Date().toISOString(),
      stocks: items.map(curatedItemToStock),
    };
  } catch (err) {
    console.error("[data] getStocks: tokens.xyz failed, using JSON fallback:", err);
    return loadStocksJson();
  }
}

/**
 * Single-ticker detail. Resolves via tokens.xyz, then enriches with all
 * variants. Returns null when the ticker cannot be resolved (404).
 */
export async function getStockByTicker(ticker: string): Promise<Stock | null> {
  if (!isTokensXyzEnabled()) {
    const data = await loadStocksJson();
    return (
      data.stocks.find(
        (s) => s.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
      ) ?? null
    );
  }

  try {
    const resolved = await resolveAsset(ticker);
    if (!resolved) return null; // 404 → ticker_not_found

    const symbol = resolved.asset?.symbol ?? ticker.toUpperCase();
    const primary = resolved.variant;
    const price = primary?.market?.price ?? resolved.canonicalMarket?.price ?? 0;
    const volume = primary?.market?.volume24hUSD ?? 0;

    // Prefer the full liquidity-ranked variant list; fall back to the
    // primary variant from resolve.
    let variants: TokensXyzVariant[] = [];
    try {
      const v = await getVariants(resolved.assetId);
      variants = v?.variants ?? [];
    } catch {
      variants = [];
    }
    if (variants.length === 0 && primary) variants = [primary];

    return {
      underlying_ticker: symbol,
      company_name: resolved.asset?.name ?? symbol,
      listing_market: "",
      market_cap_usd: 0,
      price_usd: price,
      price_change_24h_pct: 0,
      price_change_7d_pct: 0,
      price_change_30d_pct: 0,
      volume_24h_usd: volume,
      earnings_next_date: null,
      tokenized_versions: variants.map((v) =>
        variantToTokenized(v, symbol, price, volume),
      ),
    };
  } catch (err) {
    console.error(`[data] getStockByTicker(${ticker}) failed:`, err);
    // Fall back to JSON so a transient API error still serves data.
    const data = await loadStocksJson();
    return (
      data.stocks.find(
        (s) => s.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
      ) ?? null
    );
  }
}

/**
 * Liquidity view. With a ticker, returns tokens.xyz markets (DEX pools)
 * for that ticker's primary variant. Without a ticker, returns a
 * lightweight overview derived from the curated stats.
 *
 * Returns null only when a specific `ticker` cannot be resolved (404).
 */
export function getLiquidity(): Promise<LiquidityFile>;
export function getLiquidity(
  ticker: string | undefined,
): Promise<LiquidityFile | null>;
export async function getLiquidity(
  ticker?: string,
): Promise<LiquidityFile | null> {
  if (!isTokensXyzEnabled()) {
    const data = await loadLiquidityJson();
    if (!ticker) return data;
    return {
      ...data,
      pairs: data.pairs.filter(
        (p) => p.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
      ),
    };
  }

  if (ticker) {
    try {
      const resolved = await resolveAsset(ticker);
      if (!resolved || !resolved.variant?.mint) return null;
      const mint = resolved.variant.mint;
      const symbol = resolved.asset?.symbol ?? ticker.toUpperCase();
      const tokenSymbol = resolved.variant.symbol ?? `${symbol}x`;
      const markets = await getMarkets(resolved.assetId, mint);
      const pools = markets?.markets ?? [];

      const top_pools: LiquidityPool[] = pools.map((m) => ({
        venue: m.venue ?? m.dex ?? "DEX",
        pair: m.pair ?? m.pairName ?? `${tokenSymbol} / USDC`,
        tvl_usd: m.tvlUSD ?? m.liquidityUSD ?? 0,
        fee_bps: m.feeBps ?? null,
      }));

      const dexPrice =
        pools.find((m) => typeof m.price === "number")?.price ??
        resolved.variant.market?.price ??
        0;
      const officialPrice = resolved.canonicalMarket?.price ?? dexPrice;
      const deviation =
        officialPrice > 0
          ? ((dexPrice - officialPrice) / officialPrice) * 100
          : 0;
      const tvl = top_pools.reduce((sum, p) => sum + p.tvl_usd, 0);

      return {
        source: TOKENS_XYZ_SOURCE,
        note: "DEX pools aggregated and liquidity-ranked by tokens.xyz (Jupiter / Raydium / Orca / Meteora).",
        updated_at: new Date().toISOString(),
        pairs: [
          {
            token_symbol: tokenSymbol,
            underlying_ticker: symbol,
            official_price_usd: officialPrice,
            dex_price_usd: dexPrice,
            deviation_pct: Number(deviation.toFixed(3)),
            tvl_usd: tvl,
            volume_24h_usd: resolved.variant.market?.volume24hUSD ?? 0,
            top_pools,
            arbitrage_signal:
              Math.abs(deviation) < 0.25
                ? "neutral"
                : deviation > 0
                  ? "premium (DEX rich vs listing)"
                  : "discount (DEX cheap vs listing)",
          },
        ],
      };
    } catch (err) {
      console.error(`[data] getLiquidity(${ticker}) failed:`, err);
      const data = await loadLiquidityJson();
      return {
        ...data,
        pairs: data.pairs.filter(
          (p) => p.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
        ),
      };
    }
  }

  // No ticker: lightweight overview from curated stats (single API call,
  // no per-asset markets fan-out). top_pools is omitted at this altitude.
  try {
    const curated = await getCuratedStocks();
    const items = curated?.items ?? curated?.stocks ?? [];
    if (items.length === 0) return loadLiquidityJson();
    const pairs: LiquidityPair[] = items
      .filter((item) => item.primaryVariant)
      .map((item) => {
        const symbol = item.symbol ?? item.asset?.symbol ?? item.assetId ?? "";
        const v = item.primaryVariant!;
        const stats = item.stats ?? {};
        const price = stats.price ?? 0;
        return {
          token_symbol: v.symbol ?? `${symbol}x`,
          underlying_ticker: symbol,
          official_price_usd: price,
          dex_price_usd: v.market?.price ?? price,
          deviation_pct: 0,
          tvl_usd: stats.liquidity ?? stats.liquidityUSD ?? 0,
          volume_24h_usd: stats.volume24hUSD ?? 0,
          top_pools: [],
          arbitrage_signal: "neutral",
        };
      });
    return {
      source: TOKENS_XYZ_SOURCE,
      note: "Liquidity overview derived from tokens.xyz curated stats. Pass ?ticker=<sym> for ranked DEX pools.",
      updated_at: new Date().toISOString(),
      pairs,
    };
  } catch (err) {
    console.error("[data] getLiquidity overview failed, using JSON fallback:", err);
    return loadLiquidityJson();
  }
}
