import Link from "next/link";
import { issuerShort, loadSummaries } from "@/lib/solana-stocks-load";
import { PER_CALL_PRICE } from "@/lib/x402";
import { SolanaMark } from "../components/solana-mark";
import { StocksTable, type StockRow } from "./stocks-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every tokenized stock issued on Solana (xStocks, Ondo Global Markets), one
 * row per underlying ticker, joined to the dated earnings conditions this site
 * sets and scores. Each row leads to /solana-stocks/{ticker}, which is where
 * the per-call full record is explained. No prices: verdicts are judged on
 * disclosures, not on the stock price.
 */
export default async function SolanaStocksPage() {
  const data = await loadSummaries().catch(() => null);
  if (!data) {
    return <p className="p-8 text-sm text-slate-400">Couldn&apos;t load the token list.</p>;
  }

  // Compact rows: the full list is ~1,500 tickers, so only what the table shows.
  const rows: StockRow[] = data.rows.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    tokens: s.tokens.map((t) => ({ issuer: issuerShort(t.issuer), symbol: t.symbol, mint: t.solana_mint })),
    next: s.next_earnings ? { date: s.next_earnings.date, source: s.next_earnings.target_date_source } : null,
    conditions: s.conditions,
    verdict: s.latest_verdict ? { status: s.latest_verdict.status, judged_at: s.latest_verdict.judged_at } : null,
  }));
  const counts = {
    xStocks: rows.filter((r) => r.tokens.some((t) => t.issuer === "xStocks")).length,
    Ondo: rows.filter((r) => r.tokens.some((t) => t.issuer === "Ondo")).length,
    covered: rows.filter((r) => r.conditions > 0).length,
  };

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
          Every equity token issued on Solana by xStocks ({counts.xStocks.toLocaleString()}) and Ondo Global
          Markets ({counts.Ondo.toLocaleString()}), with its mint. For {counts.covered}{" "}
          of them this site sets a
          dated earnings condition and scores it HIT / PARTIAL / MISS from the company&apos;s own disclosure.
          Pick a ticker for its page; the full condition-and-verdict history is{" "}
          <span className="font-semibold text-slate-700">{PER_CALL_PRICE.usdc} USDC per call</span> over x402.
        </p>
        <p className="text-[12px] text-slate-400">
          Next earnings = the nearest dated deadline among this site&apos;s conditions —{" "}
          <span className="text-emerald-600">IR-confirmed</span> when read off the company&apos;s investor page,{" "}
          <span className="text-amber-600">estimated</span>{" "}otherwise. Token list refreshed weekly from the
          issuers&apos; own pages (last {data.updatedAt.slice(0, 10)}).
        </p>
      </header>

      <StocksTable rows={rows} today={data.today} />

      <p className="text-xs text-slate-400">
        Informational only — not investment advice. No market prices are shown or used.{" "}
        <Link href="/" className="text-slate-500 underline">
          Home
        </Link>
      </p>
    </div>
  );
}
