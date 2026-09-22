import Link from "next/link";
import { getPortfolioHistory } from "@/lib/data";
import type { Portfolio, PortfolioChange } from "@/lib/data";
import { DataBanner } from "../../../components/data-banner";

const CHANGE_STYLE: Record<PortfolioChange["action"], { dot: string; label: string }> = {
  add: { dot: "bg-emerald-500", label: "新規" },
  remove: { dot: "bg-rose-500", label: "除外" },
  increase: { dot: "bg-amber-500", label: "増" },
  decrease: { dot: "bg-amber-500", label: "減" },
  hold: { dot: "bg-slate-300", label: "据置" },
};

function ChangeTimeline({ changes }: { changes?: PortfolioChange[] }) {
  const notable = (changes ?? []).filter((c) => c.action !== "hold");
  if (notable.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {notable.map((c) => {
        const s = CHANGE_STYLE[c.action];
        return (
          <span
            key={`${c.ticker}-${c.action}`}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500"
          >
            <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
            {c.ticker} {s.label}
            {c.action === "increase" || c.action === "decrease"
              ? ` ${c.from_weight?.toFixed(0)}→${c.to_weight?.toFixed(0)}%`
              : c.action === "add"
                ? ` ${c.to_weight?.toFixed(0)}%`
                : ""}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Past weekly selections and what changed between them.
 *
 * Deliberately shows no P&L or benchmark comparison: the product records which
 * catalysts Claude called and whether they landed, not what a portfolio would
 * have returned. The SPY/QQQ series behind the old chart is frozen and is no
 * longer generated (see update-performance.yml).
 */
export default async function PortfolioHistoryPage() {
  const data = await getPortfolioHistory();

  const all: Portfolio[] = [
    ...(data.current ? [data.current] : []),
    ...data.history,
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">Claude Portfolio — History</h1>
        <p className="text-sm text-slate-500">
          過去の週次ポートフォリオと、週ごとの銘柄入替。{" "}
          <Link href="/alpha/portfolio" className="text-sky-600">
            current
          </Link>
        </p>
      </header>

      <DataBanner source={data.source} note={data.note} updatedAt={data.updated_at} />

      {all.length === 0 ? (
        <p className="text-sm text-slate-400">履歴がありません。</p>
      ) : (
        <div className="space-y-4">
          {all.map((p, idx) => (
            <div key={`${p.week_of}-${idx}`} className="terminal-card p-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-slate-900 font-bold">week of {p.week_of}</span>
                <span className="text-xs text-slate-400">{p.model}</span>
              </div>
              {p.rationale && (
                <p className="text-sm text-slate-500 mb-2">{p.rationale}</p>
              )}
              <ChangeTimeline changes={p.changes} />
              <div className="flex flex-wrap gap-2 text-xs">
                {p.holdings.map((h) => (
                  <span
                    key={h.ticker}
                    className="px-2 py-1 rounded bg-slate-100 text-slate-700"
                  >
                    {h.ticker} {h.weight.toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。
      </p>
    </div>
  );
}
