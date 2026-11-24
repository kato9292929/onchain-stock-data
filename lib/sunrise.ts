import type { SolanaStocksFile } from "@/lib/solana-stocks";

/** Where the Sunrise listings come from (its app page, read weekly). */
export const SUNRISE_SOURCE = "https://app.sunrise.xyz";

export interface SunriseListing {
  ticker: string;
  name: string;
  symbol: string;
  mint: string;
  issuer: string;
  listed_at: string;
}

/**
 * The tokenized stocks listed on Solana via Sunrise, newest listing first. Only
 * rows the weekly refresh matched to Sunrise's own list carry
 * `sunrise_listed_at`. Pure.
 */
export function sunriseListings(file: SolanaStocksFile): SunriseListing[] {
  return file.tokens
    .filter((t) => t.sunrise_listed_at)
    .map((t) => ({ ticker: t.ticker, name: t.name, symbol: t.symbol, mint: t.solana_mint, issuer: t.issuer, listed_at: t.sunrise_listed_at! }))
    .sort((a, b) => b.listed_at.localeCompare(a.listed_at) || a.ticker.localeCompare(b.ticker));
}
