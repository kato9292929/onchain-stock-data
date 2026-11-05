import { promises as fs } from "node:fs";
import path from "node:path";
import {
  conditionsFor,
  financialsOf,
  freeRow,
  latestVerdict,
  nextEarningsOf,
  resultCounts,
  signalsFor,
  type ConditionRow,
  type NextEarnings,
  type Records,
} from "@/lib/company-record";

/**
 * Tokenized stocks on Solana (xStocks, Ondo Global Markets), joined to what
 * this site already records about the underlying company: the dated
 * conditions, their verdicts, and the next dated deadline.
 *
 * The token list is data/solana-stocks.json (scripts/refresh-solana-stocks.mjs,
 * weekly, issuers' own pages). The next earnings date is
 * data/earnings-dates.json (primary sources only), financials are
 * data/financials.json (SEC / TDnet XBRL), and the conditions come from the
 * files the scorecards use — nothing here fetches, prices or calls a model.
 */

export interface SolanaToken {
  ticker: string;
  symbol: string;
  name: string;
  issuer: string;
  asset_type: string | null;
  solana_mint: string;
  source_url: string;
  fetched_at: string;
}

export interface SolanaStocksFile {
  source: string;
  note: string;
  updated_at: string;
  sources: Record<
    string,
    { issuer: string; url: string | null; fetched_at: string | null; ok: boolean; count: number; last_error?: string }
  >;
  tokens: SolanaToken[];
}

export async function getSolanaStocks(): Promise<SolanaStocksFile> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "solana-stocks.json"),
    "utf8",
  );
  return JSON.parse(raw) as SolanaStocksFile;
}

export {
  conditionsFor,
  latestVerdict,
  signalsFor,
  type ConditionRow,
  type ConditionRowFull,
  type NextEarnings,
  type Records,
} from "@/lib/company-record";

export interface TickerSummary {
  ticker: string;
  name: string;
  tokens: Array<Pick<SolanaToken, "issuer" | "symbol" | "solana_mint" | "asset_type" | "source_url" | "fetched_at">>;
  next_earnings: NextEarnings;
  conditions: number;
  latest_verdict: ConditionRow | null;
}

/** One row per underlying ticker, for the page and the free response. */
export function summarize(file: SolanaStocksFile, rec: Records, today: string): TickerSummary[] {
  const byTicker = new Map<string, SolanaToken[]>();
  for (const t of file.tokens) {
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }
  const out: TickerSummary[] = [];
  for (const [ticker, tokens] of byTicker) {
    const rows = conditionsFor(ticker, rec);
    out.push({
      ticker,
      name: tokens[0].name,
      tokens: tokens.map(({ issuer, symbol, solana_mint, asset_type, source_url, fetched_at }) => ({
        issuer,
        symbol,
        solana_mint,
        asset_type,
        source_url,
        fetched_at,
      })),
      next_earnings: nextEarningsOf(ticker, rec, today),
      conditions: rows.length,
      latest_verdict: latestVerdict(rows),
    });
  }
  return out;
}

// ── /api/solana-stocks/{ticker} ───────────────────────────────────────────
// The response bodies and the who-pays decision live here, not in the route,
// so they can be tested without importing the x402 wrapper (which builds a
// paywall at module scope).

/** Shown in the 402 challenge and in /.well-known/x402.json. Field meanings: /docs. */
export const PAID_DESCRIPTION =
  "Tokenized stock on Solana (xStocks / Ondo Global Markets) — full record for the underlying: every " +
  "condition this site set on it (question, target date, result, evidence URL, reasoning, verdict history), " +
  "the next earnings date from a primary source, and the latest disclosed financials extracted from the " +
  "filing (SEC EDGAR XBRL / TDnet 決算短信 XBRL, each value with its document URL). Only tickers with at " +
  "least one condition are charged. Field reference: /docs.";

export type SolanaStockAccess = "not-found" | "free-only" | "paid";

export function classifySolanaStockAccess(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
): SolanaStockAccess {
  const want = ticker.toUpperCase();
  if (!file.tokens.some((t) => t.ticker === want)) return "not-found";
  return conditionsFor(want, rec).length > 0 ? "paid" : "free-only";
}

export function freeBody(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
  today: string,
  baseUrl: string,
) {
  const want = ticker.toUpperCase();
  const tokens = file.tokens.filter((t) => t.ticker === want);
  if (tokens.length === 0) return null;
  const rows = conditionsFor(want, rec);
  return {
    ticker: want,
    name: tokens[0].name,
    tokens: tokens.map(({ issuer, symbol, solana_mint, asset_type, source_url, fetched_at }) => ({
      issuer,
      symbol,
      solana_mint,
      asset_type,
      source_url,
      fetched_at,
    })),
    next_earnings: nextEarningsOf(want, rec, today),
    condition_count: rows.length,
    result_counts: resultCounts(rows),
    latest_verdict: latestVerdict(rows),
    full:
      rows.length > 0
        ? {
            url: `${baseUrl}/api/solana-stocks/${encodeURIComponent(want)}?view=full`,
            price_usdc: "0.001",
            network: "solana",
            scheme: "exact",
          }
        : null,
    token_list_updated_at: file.updated_at,
  };
}

export function fullBody(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
  today: string,
  baseUrl: string,
) {
  const free = freeBody(ticker, file, rec, today, baseUrl);
  if (!free) return null;
  const { full: _full, ...rest } = free;
  void _full;
  return {
    ...rest,
    conditions: conditionsFor(ticker, rec),
    financials: financialsOf(ticker, rec),
    signals: signalsFor(ticker, rec),
  };
}

/** Free rows for the page (question, date, result, evidence). */
export function freeConditions(ticker: string, rec: Records) {
  return conditionsFor(ticker, rec).map(freeRow);
}
