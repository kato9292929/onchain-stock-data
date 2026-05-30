import Link from "next/link";
import { getPortfolioHistory } from "@/lib/data";
import { DataBanner } from "../../components/data-banner";

const fmtUsd = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

export default async function PortfolioPage() {
  const data = await getPortfolioHistory();
  const p = data.current;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Claude Portfolio</h1>
        <p className="text-sm text-zinc-400">
          毎週月曜朝 6 時 (JST) に Claude が選ぶ米株 10 銘柄。SPY / NASDAQ (QQQ)
          との比較は{" "}
          <Link href="/alpha/portfolio/history" className="text-cyan-400">
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
                  <tr key={h.ticker} className="border-b border-zinc-900">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/alpha/portfolio/${h.ticker}`}
                        className="text-cyan-300 font-bold"
                      >
                        {h.ticker}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">{h.company_name}</td>
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
