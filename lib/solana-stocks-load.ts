import {
  getJpPortfolioEvaluations,
  getJpPortfolioHistory,
  getPortfolioEvaluations,
  getPortfolioHistory,
} from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { getSignals } from "@/lib/signals";
import { getEarningsDates, getFinancials, type Records } from "@/lib/company-record";
import { getJpListed, getThemes } from "@/lib/theme-members";
import {
  getSolanaStocks,
  summarize,
  type SolanaStocksFile,
  type TickerSummary,
} from "@/lib/solana-stocks";

/**
 * Every committed file a company record is built from. Shared by
 * /api/solana-stocks, /api/catalyst and the pages, so they all read the same
 * files the same way. Static reads only; a missing file is null.
 */
export async function loadRecords(): Promise<Records> {
  const [usHistory, usEvals, jpHistory, jpEvals, externals, irFair, signals, earnings, financials, themes, jpListed] =
    await Promise.all([
      getPortfolioHistory().catch(() => null),
      getPortfolioEvaluations().catch(() => null),
      getJpPortfolioHistory().catch(() => null),
      getJpPortfolioEvaluations().catch(() => null),
      readExternalCatalysts().catch(() => []),
      getIrFairFile().catch(() => null),
      getSignals().catch(() => null),
      getEarningsDates(),
      getFinancials(),
      getThemes(),
      getJpListed(),
    ]);
  return { usHistory, usEvals, jpHistory, jpEvals, externals, irFair, signals, earnings, financials, themes, jpListed };
}

export async function loadSolanaStocks(): Promise<{
  file: SolanaStocksFile;
  rec: Records;
  today: string;
}> {
  const [file, rec] = await Promise.all([getSolanaStocks(), loadRecords()]);
  return { file, rec, today: new Date().toISOString().slice(0, 10) };
}

/**
 * Default order: tickers with conditions first, then the nearest confirmed
 * earnings date, then alphabetical.
 */
export function byDefaultOrder(a: TickerSummary, b: TickerSummary): number {
  const ca = a.conditions > 0 ? 0 : 1;
  const cb = b.conditions > 0 ? 0 : 1;
  if (ca !== cb) return ca - cb;
  const da = a.next_earnings?.date ?? "9999-12-31";
  const db = b.next_earnings?.date ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
}

export async function loadSummaries(): Promise<{ rows: TickerSummary[]; updatedAt: string; today: string }> {
  const { file, rec, today } = await loadSolanaStocks();
  return { rows: summarize(file, rec, today).sort(byDefaultOrder), updatedAt: file.updated_at, today };
}

/** "xStocks (Backed / Kraken)" → "xStocks", "Ondo Global Markets" → "Ondo". */
export function issuerShort(issuer: string): string {
  return issuer.startsWith("xStocks") ? "xStocks" : issuer.startsWith("Ondo") ? "Ondo" : issuer;
}
