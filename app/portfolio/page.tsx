import Link from "next/link";
import {
  getPortfolioHistory,
  getPerformanceHistory,
  getStocks,
} from "@/lib/data";
import { PortfolioSection } from "../components/portfolio-section";
import { AllocationBreakdown } from "../components/allocation-breakdown";
import { PortfolioPnl } from "../components/portfolio-pnl";
import { PortfolioToggle } from "../components/portfolio-toggle";

export const dynamic = "force-dynamic";

/**
 * US Claude Portfolio page: allocation breakdown + P&L ($10k rebased vs SPY/QQQ)
 * + weekly holdings. The JP portfolio lives on its own page (/portfolio/jp).
 * Presentation only — the API routes are unchanged.
 */

/** Tickers with an xStock (Backed Finance) tokenized version — US enrichment. */
async function xstockTickers(): Promise<Set<string>> {
  try {
    const data = await getStocks();
    const set = new Set<string>();
    for (const s of data.stocks) {
      const isXStock = s.tokenized_versions.some(
        (v) =>
          /xstock|backed/i.test(v.issuer) ||
          (v.venues ?? []).some((t) => /xstock/i.test(t)),
      );
      if (isXStock) set.add(s.underlying_ticker.toUpperCase());
    }
    return set;
  } catch {
    return new Set();
  }
}

export default async function PortfolioPage() {
  const [us, perf, onchain] = await Promise.all([
    getPortfolioHistory().catch(() => null),
    getPerformanceHistory().catch(() => null),
    xstockTickers(),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl sm:text-4xl text-white">Claude Portfolio</h1>
        <p className="text-sm text-white/55 max-w-2xl">
          Ten US and ten JP names picked weekly by Claude, each with a verifiable
          1-month catalyst. Published at{" "}
          <code className="text-white/75">/api/alpha/portfolio/current</code> and{" "}
          <code className="text-white/75">/api/alpha/jp/portfolio/current</code>.
        </p>
        <PortfolioToggle active="us" />
      </header>

      {perf && perf.records.length > 0 && (
        <PortfolioPnl records={perf.records} baseDate={perf.base_date} />
      )}

      {us?.current && (
        <AllocationBreakdown holdings={us.current.holdings} accentTickers={onchain} />
      )}

      {us ? (
        <PortfolioSection
          title="Holdings & thesis"
          subtitle={
            <>
              Weekly picks &amp; rotations — see{" "}
              <Link href="/alpha/portfolio/history" className="text-white underline decoration-white/30 underline-offset-2">
                history
              </Link>
              .
            </>
          }
          history={us}
          enrichmentTickers={onchain}
          tickerBaseHref="/alpha/portfolio"
        />
      ) : (
        <p className="text-sm text-white/45">Couldn&apos;t load US data.</p>
      )}

      <p className="text-xs text-white/40">
        Informational only — not investment advice. P&amp;L is an index rebased at
        base_date (daily-chained from holding closes) applied to $10,000.
      </p>
    </div>
  );
}
