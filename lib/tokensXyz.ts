/**
 * tokens.xyz Assets API client.
 *
 * tokens.xyz (Solana Foundation managed) is the unified asset registry that
 * resolves xStock / Ondo / PreStocks variants to a canonical `assetId` and
 * returns liquidity-ranked markets. It replaces the per-DEX lookups
 * (Birdeye / Jupiter / Raydium / Orca / Meteora) and the hand-maintained
 * `data/stocks.json` for Solana tokenized-equity resolution.
 *
 * Docs: https://docs.tokens.xyz/v1/quickstart
 *
 * Auth: header `x-api-key: $TOKENS_XYZ_API_KEY` (set in Vercel env, never
 * committed). When the key is absent the caller is expected to fall back to
 * the bundled `data/*.json` sample data.
 */

const BASE_URL = "https://api.tokens.xyz/v1";
const MAX_RETRIES = 3;

/** True when a TOKENS_XYZ_API_KEY is configured. */
export function isTokensXyzEnabled(): boolean {
  return Boolean(process.env.TOKENS_XYZ_API_KEY);
}

function requireApiKey(): string {
  const key = process.env.TOKENS_XYZ_API_KEY;
  if (!key) {
    throw new Error(
      "TOKENS_XYZ_API_KEY is not set — cannot call the tokens.xyz Assets API",
    );
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type QueryValue = string | number | boolean | null | undefined;

/**
 * Low-level GET against the Assets API.
 *
 * - Logs the `x-request-id` header for debugging.
 * - 429 RateLimited → exponential backoff, up to MAX_RETRIES retries.
 * - 404 NotFound → resolves to `null` (does not throw).
 * - any other non-2xx → throws.
 */
async function apiGet<T>(
  path: string,
  query?: Record<string, QueryValue>,
): Promise<T | null> {
  const key = requireApiKey();
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  let attempt = 0;
  // Loop guarded by MAX_RETRIES for the 429 case; all other outcomes return.
  while (true) {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": key, accept: "application/json" },
      cache: "no-store",
    });
    const requestId = res.headers.get("x-request-id") ?? "n/a";

    if (res.status === 404) {
      console.info(
        `[tokens.xyz] 404 NotFound ${path} (x-request-id=${requestId})`,
      );
      return null;
    }

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const backoffMs = 2 ** attempt * 1000; // 1s, 2s, 4s
        console.warn(
          `[tokens.xyz] 429 RateLimited ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms (x-request-id=${requestId})`,
        );
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }
      throw new Error(
        `tokens.xyz 429 RateLimited ${path} after ${MAX_RETRIES} retries (x-request-id=${requestId})`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `tokens.xyz ${res.status} ${path} (x-request-id=${requestId}) ${body.slice(0, 200)}`,
      );
    }

    console.info(`[tokens.xyz] 200 ${path} (x-request-id=${requestId})`);
    return (await res.json()) as T;
  }
}

// ── Response shapes ──────────────────────────────────────────────────────
// The Assets API is young; field names are modelled from the documented
// examples but mappers below read defensively so additive changes do not
// break the build.

export interface TokensXyzAsset {
  assetId: string;
  name?: string;
  symbol?: string;
  category?: string;
  aliases?: string[];
}

export interface TokensXyzVariant {
  mint?: string | null;
  chain?: string;
  kind?: string;
  tags?: string[];
  label?: string;
  symbol?: string;
  decimals?: number;
  liquidityTier?: string;
  trustTier?: string;
  market?: { price?: number; volume24hUSD?: number; liquidityUSD?: number };
}

export interface ResolveResponse {
  assetId: string;
  mint?: string | null;
  asset?: TokensXyzAsset;
  variant?: TokensXyzVariant;
  canonicalMarket?: { price?: number };
}

export interface VariantsResponse {
  assetId?: string;
  variants?: TokensXyzVariant[];
}

export interface Market {
  venue?: string;
  dex?: string;
  pair?: string;
  pairName?: string;
  tvlUSD?: number;
  liquidityUSD?: number;
  feeBps?: number | null;
  price?: number;
  volume24hUSD?: number;
}

export interface MarketsResponse {
  assetId?: string;
  mint?: string;
  markets?: Market[];
  offset?: number;
  limit?: number;
  total?: number;
}

export interface OhlcvResponse {
  assetId?: string;
  mint?: string;
  interval?: string;
  candles?: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
}

export interface CuratedStats {
  price?: number;
  liquidity?: number;
  liquidityUSD?: number;
  volume24hUSD?: number;
  marketCap?: number;
  priceChange24hPct?: number;
  ["24h"]?: number;
}

export interface CuratedItem {
  assetId?: string;
  asset?: TokensXyzAsset;
  symbol?: string;
  name?: string;
  category?: string;
  listingMarket?: string;
  exchange?: string;
  stats?: CuratedStats;
  primaryVariant?: TokensXyzVariant;
}

export interface CuratedResponse {
  list?: string;
  items?: CuratedItem[];
  stocks?: CuratedItem[];
}

// ── Public API ───────────────────────────────────────────────────────────

/** Resolve a ticker / assetId to its canonical asset + primary variant. */
export async function resolveAsset(
  ref: string,
): Promise<ResolveResponse | null> {
  try {
    return await apiGet<ResolveResponse>("/assets/resolve", { ref });
  } catch (err) {
    console.error(`[tokens.xyz] resolveAsset(${ref}) failed:`, err);
    throw err;
  }
}

/** All variants (xStock + Ondo + PreStocks) for an asset, liquidity-ranked. */
export async function getVariants(
  assetId: string,
  opts: { kind?: string; liquidityTier?: string; trustTier?: string } = {},
): Promise<VariantsResponse | null> {
  try {
    return await apiGet<VariantsResponse>(
      `/assets/${encodeURIComponent(assetId)}/variants`,
      opts,
    );
  } catch (err) {
    console.error(`[tokens.xyz] getVariants(${assetId}) failed:`, err);
    throw err;
  }
}

/** Liquidity-ranked DEX pools / venues for a variant (paginated). */
export async function getMarkets(
  assetId: string,
  mint: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<MarketsResponse | null> {
  try {
    return await apiGet<MarketsResponse>(
      `/assets/${encodeURIComponent(assetId)}/markets`,
      { mint, offset: opts.offset ?? 0, limit: opts.limit ?? 10 },
    );
  } catch (err) {
    console.error(
      `[tokens.xyz] getMarkets(${assetId}, ${mint}) failed:`,
      err,
    );
    throw err;
  }
}

/** Candlesticks for a variant. */
export async function getOhlcv(
  assetId: string,
  mint: string,
  opts: { interval?: string; from?: string; to?: string } = {},
): Promise<OhlcvResponse | null> {
  try {
    return await apiGet<OhlcvResponse>(
      `/assets/${encodeURIComponent(assetId)}/ohlcv`,
      { mint, interval: opts.interval ?? "1H", from: opts.from, to: opts.to },
    );
  } catch (err) {
    console.error(`[tokens.xyz] getOhlcv(${assetId}, ${mint}) failed:`, err);
    throw err;
  }
}

/** Curated tokenized stocks list with per-asset stats + primary variant. */
export async function getCuratedStocks(): Promise<CuratedResponse | null> {
  try {
    return await apiGet<CuratedResponse>("/assets/curated", { list: "stocks" });
  } catch (err) {
    console.error("[tokens.xyz] getCuratedStocks() failed:", err);
    throw err;
  }
}
