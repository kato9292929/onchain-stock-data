import Link from "next/link";
import { getPortfolioHistory, getStocks } from "@/lib/data";
import { PortfolioSection } from "../components/portfolio-section";
import { AllocationBreakdown } from "../components/allocation-breakdown";
import { PortfolioToggle } from "../components/portfolio-toggle";

export const dynamic = "force-dynamic";

/**
 * US weekly selection: Claude's ten US names for the week, each with a
 * verifiable 1-month catalyst — a research selection, NOT a fund. No P&L /
 * benchmark tracking (the product sells the prediction record, not returns).
 * The JP selection lives on /portfolio/jp.
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
  const [us, onchain] = await Promise.all([
    getPortfolioHistory().catch(() => null),
    xstockTickers(),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl sm:text-4xl text-white">Weekly Selection</h1>
        <p className="text-sm text-white/55 max-w-2xl">
          Ten US and ten JP names picked weekly by Claude, each with a verifiable
          1-month catalyst — a research selection, not a fund. Published at{" "}
          <code className="text-white/75">/api/alpha/portfolio/current</code> and{" "}
          <code className="text-white/75">/api/alpha/jp/portfolio/current</code>.
        </p>
        <PortfolioToggle active="us" />
      </header>

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
        Informational only — not investment advice. This is a weekly research
        selection with dated catalysts; it is not a fund and no return / benchmark
        performance is tracked.
      </p>
    </div>
  );
}
