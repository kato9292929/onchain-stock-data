import { promises as fs } from "node:fs";
import path from "node:path";

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

export const getStocks = () => loadJson<StocksFile>("stocks.json");
export const getIpos = () => loadJson<IposFile>("ipo.json");
export const getLiquidity = () => loadJson<LiquidityFile>("liquidity.json");
export const getHolders = () => loadJson<HoldersFile>("holders.json");
export const getAlphaPosts = () => loadJson<AlphaPost[]>("alpha-posts.json");
