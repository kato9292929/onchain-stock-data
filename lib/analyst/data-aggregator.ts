import {
  getStocks,
  getIpos,
  getLiquidity,
  getHolders,
  getAlphaPosts,
} from "@/lib/data";

export interface AggregatedTickerData {
  ticker: string;
  stock_record: unknown;
  ipo_record: unknown;
  liquidity_for_ticker: unknown;
  holders_for_ticker: unknown;
  alpha_posts: unknown;
  cross_market_context: {
    market_updated_at: string;
    liquidity_universe_size: number;
    holders_universe_size: number;
    alpha_post_count: number;
  };
  fetch_endpoints: string[];
}

export async function aggregateForTicker(
  ticker: string,
): Promise<AggregatedTickerData> {
  const upper = ticker.toUpperCase();
  const [stocks, ipos, liquidity, holders, alphaPosts] = await Promise.all([
    getStocks(),
    getIpos(),
    getLiquidity(),
    getHolders(),
    getAlphaPosts(),
  ]);

  const stock_record =
    stocks.stocks.find((s) => s.underlying_ticker.toUpperCase() === upper) ??
    null;
  const ipo_record =
    ipos.ipos.find((i) => i.ticker.toUpperCase() === upper) ?? null;
  const liquidityPairs = liquidity?.pairs ?? [];
  const liquidity_for_ticker = liquidityPairs.filter(
    (p) => p.underlying_ticker.toUpperCase() === upper,
  );
  const holders_for_ticker = holders.tokens.filter(
    (h) => h.underlying_ticker.toUpperCase() === upper,
  );

  return {
    ticker: upper,
    stock_record,
    ipo_record,
    liquidity_for_ticker,
    holders_for_ticker,
    alpha_posts: alphaPosts,
    cross_market_context: {
      market_updated_at: stocks.updated_at,
      liquidity_universe_size: liquidityPairs.length,
      holders_universe_size: holders.tokens.length,
      alpha_post_count: alphaPosts.length,
    },
    fetch_endpoints: [
      `/api/stocks/${upper}`,
      `/api/ipo`,
      `/api/liquidity`,
      `/api/holders`,
      `/api/alpha-posts`,
    ],
  };
}

export function tickerExists(data: AggregatedTickerData): boolean {
  return Boolean(data.stock_record || data.ipo_record);
}

export function currentPriceUsd(
  data: AggregatedTickerData,
): number | undefined {
  const s = data.stock_record as { price_usd?: number } | null;
  return s?.price_usd;
}

export function companyName(data: AggregatedTickerData): string {
  const s = data.stock_record as { company_name?: string } | null;
  const i = data.ipo_record as { company_name?: string } | null;
  return s?.company_name ?? i?.company_name ?? data.ticker;
}
