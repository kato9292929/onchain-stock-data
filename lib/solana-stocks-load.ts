import { getPortfolioEvaluations, getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getSignals } from "@/lib/signals";
import {
  getSolanaStocks,
  summarize,
  type Records,
  type SolanaStocksFile,
  type TickerSummary,
} from "@/lib/solana-stocks";

/**
 * One loader for every Solana-stocks surface (pages, API, MCP), so they all
 * read the same files the same way. Static reads of committed data only.
 */
export async function loadSolanaStocks(): Promise<{
  file: SolanaStocksFile;
  rec: Records;
  today: string;
}> {
  const [file, usHistory, usEvals, externals, signals] = await Promise.all([
    getSolanaStocks(),
    getPortfolioHistory().catch(() => null),
    getPortfolioEvaluations().catch(() => null),
    readExternalCatalysts().catch(() => []),
    getSignals().catch(() => null),
  ]);
  return {
    file,
    rec: { usHistory, usEvals, externals, signals },
    today: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Default order: tickers with conditions first, then the nearest upcoming
 * deadline, then alphabetical.
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
