import { issuerShort, loadSummariesCached } from "@/lib/solana-stocks-load";
import { FIVE_MINUTES, memoize } from "@/lib/memo";
import type { StockRow } from "@/app/solana-stocks/stocks-table";

/**
 * The token list as the stocks table shows it: one compact row per ticker,
 * with the issuer counts. Built once per five minutes per server instance —
 * the front page sends only its first rows and fetches the rest from
 * /api/stocks-list when "Show all" is pressed.
 */
export const stockTableRows = memoize(async () => {
  const data = await loadSummariesCached();
  const rows: StockRow[] = data.rows.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    tokens: s.tokens.map((t) => ({ issuer: issuerShort(t.issuer), symbol: t.symbol, mint: t.solana_mint })),
    sunrise: s.tokens.find((t) => t.sunrise_listed_at)?.sunrise_listed_at ?? null,
    next: s.next_earnings.status === "confirmed" && s.next_earnings.date ? { date: s.next_earnings.date } : null,
    conditions: s.conditions,
    verdict: s.latest_verdict ? { status: s.latest_verdict.result, judged_at: s.latest_verdict.judged_at } : null,
  }));
  const counts = {
    xStocks: rows.filter((r) => r.tokens.some((t) => t.issuer === "xStocks")).length,
    Ondo: rows.filter((r) => r.tokens.some((t) => t.issuer === "Ondo")).length,
    Backpack: rows.filter((r) => r.tokens.some((t) => t.issuer === "Backpack")).length,
    Sunrise: rows.filter((r) => r.sunrise).length,
    covered: rows.filter((r) => r.conditions > 0).length,
  };
  return { rows, counts, today: data.today, updatedAt: data.updatedAt };
}, FIVE_MINUTES);
