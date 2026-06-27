import Link from "next/link";
import { getPortfolioHistory, getJpPortfolioHistory, getStocks } from "@/lib/data";
import { PortfolioSection } from "../components/portfolio-section";

export const dynamic = "force-dynamic";

/**
 * Unified Claude Portfolio page: US and JP weekly selections on one page.
 * Each section degrades independently (null current → empty state). The API
 * routes (/api/alpha/portfolio/*, /api/alpha/jp/*) are unchanged — this is a
 * presentation-only page.
 */

/** Tickers with an xStock (Backed Finance) tokenized version — US enrichment only. */
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
  const [us, jp, onchain] = await Promise.all([
    getPortfolioHistory().catch(() => null),
    getJpPortfolioHistory().catch(() => null),
    xstockTickers(),
  ]);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Claude Portfolio</h1>
        <p className="text-sm text-zinc-400">
          毎週 Claude が選ぶ米国株・日本株の各 10 銘柄。1 ヶ月の検証可能な
          catalyst を thesis に。米国株は{" "}
          <code className="text-zinc-300">/api/alpha/portfolio/current</code>、日本株は{" "}
          <code className="text-zinc-300">/api/alpha/jp/portfolio/current</code>{" "}
          で無料公開。
        </p>
      </header>

      {us ? (
        <PortfolioSection
          title="米国株"
          subtitle={
            <>
              SPY / NASDAQ (QQQ) との比較は{" "}
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
        <section className="space-y-2">
          <h2 className="text-xl font-bold">米国株</h2>
          <p className="text-sm text-zinc-500">データを読み込めませんでした。</p>
        </section>
      )}

      {jp ? (
        <PortfolioSection
          title="日本株"
          subtitle="AI・半導体・データセンター関連のサプライチェーンから選定。期日後に決算短信・適時開示で採点。"
          history={jp}
          showTargetDate
        />
      ) : (
        <section className="space-y-2">
          <h2 className="text-xl font-bold">日本株</h2>
          <p className="text-sm text-zinc-500">データを読み込めませんでした。</p>
        </section>
      )}

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。
      </p>
    </div>
  );
}
