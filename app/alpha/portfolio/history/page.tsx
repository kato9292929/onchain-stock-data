import Link from "next/link";
import { getPortfolioHistory, getPerformanceHistory } from "@/lib/data";
import type { Portfolio } from "@/lib/data";
import { DataBanner } from "../../../components/data-banner";

const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";

export default async function PortfolioHistoryPage() {
  const [data, perf] = await Promise.all([
    getPortfolioHistory(),
    getPerformanceHistory().catch(() => null),
  ]);

  const all: Portfolio[] = [
    ...(data.current ? [data.current] : []),
    ...data.history,
  ];
  const latest = perf?.records[perf.records.length - 1];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Claude Portfolio — History</h1>
        <p className="text-sm text-zinc-400">
          過去の週次ポートフォリオと、SPY / NASDAQ (QQQ) 比較。{" "}
          <Link href="/alpha/portfolio" className="text-cyan-400">
            current
          </Link>
        </p>
      </header>

      <DataBanner source={data.source} note={data.note} updatedAt={data.updated_at} />

      {latest && (
        <div className="terminal-card p-4">
          <p className="text-xs text-zinc-500 mb-2">
            performance (rebased 100 @ {perf?.base_date}) · as of {latest.date}
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span>
              Claude Portfolio:{" "}
              <span className={latest.portfolio_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                {fmtPct(latest.portfolio_return_pct)}
              </span>
            </span>
            <span>
              SPY:{" "}
              <span className={latest.spy_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                {fmtPct(latest.spy_return_pct)}
              </span>
            </span>
            <span>
              QQQ:{" "}
              <span className={latest.qqq_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                {fmtPct(latest.qqq_return_pct)}
              </span>
            </span>
          </div>
        </div>
      )}

      {all.length === 0 ? (
        <p className="text-sm text-zinc-500">履歴がありません。</p>
      ) : (
        <div className="space-y-4">
          {all.map((p, idx) => (
            <div key={`${p.week_of}-${idx}`} className="terminal-card p-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-cyan-300 font-bold">week of {p.week_of}</span>
                <span className="text-xs text-zinc-500">{p.model}</span>
              </div>
              {p.rationale && (
                <p className="text-sm text-zinc-400 mb-2">{p.rationale}</p>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                {p.holdings.map((h) => (
                  <span
                    key={h.ticker}
                    className="px-2 py-1 rounded bg-zinc-900 text-zinc-300"
                  >
                    {h.ticker} {h.weight.toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。
      </p>
    </div>
  );
}
