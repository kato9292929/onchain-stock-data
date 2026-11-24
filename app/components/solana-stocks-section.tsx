import Link from "next/link";
import { issuerShort, loadSummaries } from "@/lib/solana-stocks-load";
import { PER_CALL_PRICE } from "@/lib/x402";
import { SolanaMark } from "./solana-mark";
import { StocksTable, type StockRow } from "../solana-stocks/stocks-table";

/**
 * Every tokenized stock issued on Solana (xStocks, Ondo Global Markets, Backpack Securities), one
 * row per underlying ticker, joined to the dated earnings conditions this site
 * sets and scores. Each row leads to /solana-stocks/{ticker}, which is where
 * the per-call full record is explained. No prices: verdicts are judged on
 * disclosures, not on the stock price.
 */
export async function SolanaStocksSection({ preview }: { preview?: number } = {}) {
  const data = await loadSummaries().catch(() => null);
  if (!data) {
    return <p className="p-8 text-sm text-slate-400">Couldn&apos;t load the token list.</p>;
  }

  // Compact rows: the full list is ~1,500 tickers, so only what the table shows.
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

  if (preview) {
    return (
      <div className="font-inter">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <SolanaMark className="h-3 w-auto" title={null} />
              Stocks
            </div>
            <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">{rows.length.toLocaleString()} tokenized stocks on Solana</h2>
          </div>
        </div>
        <StocksTable rows={rows} today={data.today} preview={preview} />
      </div>
    );
  }

  return (
    <div className="font-inter space-y-8">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <SolanaMark className="h-3 w-auto" title={null} />
          Tokenized stocks on Solana
        </div>
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">
          {rows.length.toLocaleString()} tokenized stocks on Solana
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Every equity token issued on Solana by xStocks ({counts.xStocks.toLocaleString()}), Ondo Global
          Markets ({counts.Ondo.toLocaleString()}) and Backpack Securities ({counts.Backpack.toLocaleString()}; {counts.Sunrise} of them listed via Sunrise), with its mint. Per call, each US-listed company&apos;s own
          SEC filings and XBRL financials (revenue, operating income, net income, EPS, cash, shares), each value
          with its filing — plus, for {counts.covered} of them, a dated condition scored HIT / PARTIAL / MISS.{" "}
          <span className="font-semibold text-slate-700">{PER_CALL_PRICE.usdc} USDC per call</span> over x402.
        </p>
        <p className="text-[12px] text-slate-400">
          Next earnings is shown only where a primary source states it (the company&apos;s own announcement);
          otherwise it is blank, never estimated. Token list refreshed weekly from the issuers&apos; own pages
          (last {data.updatedAt.slice(0, 10)}).{" "}
          <Link href="/docs" className="underline">
            Field reference
          </Link>
        </p>
      </header>

      <StocksTable rows={rows} today={data.today} />
    </div>
  );
}
