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
        <h1 className="text-2xl font-bold">Claude Portfolio</h1>
        <p className="text-sm text-zinc-400">
          毎週 Claude が選ぶ米国株・日本株の各 10 銘柄。1 ヶ月の検証可能な catalyst を
          thesis に。米国株は{" "}
          <code className="text-zinc-300">/api/alpha/portfolio/current</code>、日本株は{" "}
          <code className="text-zinc-300">/api/alpha/jp/portfolio/current</code> で公開。
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
          title="銘柄と thesis"
          subtitle={
            <>
              週次の選定・入替は{" "}
              <Link href="/alpha/portfolio/history" className="text-gold">
                history
              </Link>{" "}
              を参照。
            </>
          }
          history={us}
          enrichmentTickers={onchain}
          tickerBaseHref="/alpha/portfolio"
        />
      ) : (
        <p className="text-sm text-zinc-500">米国株データを読み込めませんでした。</p>
      )}

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。表示の損益は
        base_date 起点のインデックス（保有終値から日次連鎖）に $10,000 を当てた参考値です。
      </p>
    </div>
  );
}
