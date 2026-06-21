import Link from "next/link";
import { getPortfolioHistory, getStocks } from "@/lib/data";
import { DataBanner } from "../../components/data-banner";

const fmtUsd = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

/**
 * Tickers that have an xStock (Backed Finance) tokenized version on Solana.
 * Derived from the existing stocks registry — used ONLY for page enrichment
 * (badge + internal links), never for selection.
 */
async function xstockTickers(): Promise<Set<string>> {
  try {
    const data = await getStocks();
    const set = new Set<string>();
    for (const s of data.stocks) {
      const isXStock = s.tokenized_versions.some((v) =>
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

function OnchainEnrichment({ ticker }: { ticker: string }) {
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
        Solana tokenized
      </span>
      <Link href={`/liquidity?ticker=${ticker}`} className="text-[11px] text-gold">
        liquidity
      </Link>
      <Link href="/holders" className="text-[11px] text-gold">
        holders
      </Link>
    </span>
  );
}

export default async function PortfolioPage() {
  const [data, onchain] = await Promise.all([
    getPortfolioHistory(),
    xstockTickers(),
  ]);
  const p = data.current;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Claude Portfolio</h1>
        <p className="text-sm text-zinc-400">
          毎週 Claude が選ぶ米株 10 銘柄。1 ヶ月の検証可能な catalyst を thesis に。
          SPY / NASDAQ (QQQ) との比較は{" "}
          <Link href="/alpha/portfolio/history" className="text-gold">
            history
          </Link>{" "}
          を参照。JSON は{" "}
          <code className="text-zinc-300">/api/alpha/portfolio/current</code>{" "}
          で無料公開。
        </p>
      </header>

      <DataBanner source={data.source} note={data.note} updatedAt={data.updated_at} />

      {!p ? (
        <p className="text-sm text-zinc-500">まだポートフォリオがありません。</p>
      ) : (
        <>
          <div className="text-xs text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>week_of: <span className="text-zinc-300">{p.week_of}</span></span>
            <span>horizon: <span className="text-zinc-300">{p.horizon}</span></span>
            <span>model: <span className="text-zinc-300">{p.model}</span></span>
            <span>generated_at: <span className="text-zinc-300">{p.generated_at}</span></span>
          </div>

          {p.rationale && (
            <div className="terminal-card p-4 text-sm text-zinc-300">
              {p.rationale}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500 text-left border-b border-zinc-800">
                <tr>
                  <th className="py-2 pr-4">Ticker</th>
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4 text-right">Weight</th>
                  <th className="py-2 pr-4 text-right">Entry</th>
                  <th className="py-2">Thesis</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.map((h) => (
                  <tr key={h.ticker} className="border-b border-zinc-900 align-top">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/alpha/portfolio/${h.ticker}`}
                        className="text-gold-bright font-bold"
                      >
                        {h.ticker}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">
                      <div>{h.company_name}</div>
                      {onchain.has(h.ticker.toUpperCase()) && (
                        <div className="mt-1">
                          <OnchainEnrichment ticker={h.ticker.toUpperCase()} />
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right text-zinc-200">
                      {h.weight.toFixed(1)}%
                    </td>
                    <td className="py-2 pr-4 text-right text-zinc-400">
                      {fmtUsd(h.entry_price_usd)}
                    </td>
                    <td className="py-2 text-zinc-400">{h.thesis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。
      </p>
    </div>
  );
}
