import Link from "next/link";
import { getJpPortfolioHistory, getJpPortfolioEvaluations } from "@/lib/data";
import type { EvaluationStatus } from "@/lib/data";
import { PortfolioSection } from "../../components/portfolio-section";
import { AllocationBreakdown } from "../../components/allocation-breakdown";
import { PortfolioToggle } from "../../components/portfolio-toggle";

export const dynamic = "force-dynamic";

/**
 * JP Claude Portfolio page: allocation breakdown + weekly holdings + catalyst
 * hit-rate. JP tracks catalyst verdicts (決算短信・適時開示) rather than a
 * benchmark index, so there is no $10k P&L here (unlike the US page).
 */

const STATUS_STYLE: Record<EvaluationStatus, { label: string; cls: string }> = {
  hit: { label: "hit", cls: "text-emerald-400" },
  partial: { label: "partial", cls: "text-amber-400" },
  miss: { label: "miss", cls: "text-red-400" },
  na: { label: "na", cls: "text-zinc-500" },
  pending: { label: "pending", cls: "text-zinc-400" },
};

function HitRate({ counts }: { counts: Record<EvaluationStatus, number> }) {
  const judged = counts.hit + counts.partial + counts.miss + counts.na;
  const rate = judged > 0 ? ((counts.hit / judged) * 100).toFixed(0) : "—";
  return (
    <div className="terminal-card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold text-zinc-200">Catalyst hit-rate</h3>
        <span className="text-xs text-zinc-500">judged {judged} 件</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-lg font-bold text-emerald-400 tabular-nums">
          {rate}
          {rate !== "—" && "%"}{" "}
          <span className="text-xs font-normal text-zinc-500">hit</span>
        </span>
        {(Object.keys(STATUS_STYLE) as EvaluationStatus[]).map((s) => (
          <span key={s} className="text-zinc-500">
            {STATUS_STYLE[s].label}:{" "}
            <span className={`tabular-nums ${STATUS_STYLE[s].cls}`}>{counts[s]}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        期日 + 7 日後に決算短信・適時開示を web 検索で採点。
      </p>
    </div>
  );
}

export default async function JpPortfolioPage() {
  const [jp, evals] = await Promise.all([
    getJpPortfolioHistory().catch(() => null),
    getJpPortfolioEvaluations().catch(() => null),
  ]);

  const counts: Record<EvaluationStatus, number> = {
    pending: 0,
    hit: 0,
    partial: 0,
    miss: 0,
    na: 0,
  };
  for (const e of evals?.evaluations ?? []) counts[e.status] += 1;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Claude Portfolio</h1>
        <p className="text-sm text-zinc-400">
          AI・半導体・データセンター関連のサプライチェーンから毎週 10 銘柄を選定。日本株は{" "}
          <code className="text-zinc-300">/api/alpha/jp/portfolio/current</code> で公開。
        </p>
        <PortfolioToggle active="jp" />
      </header>

      {evals && <HitRate counts={counts} />}

      {jp?.current && <AllocationBreakdown holdings={jp.current.holdings} />}

      {jp ? (
        <PortfolioSection
          title="銘柄と thesis"
          subtitle="期日後に決算短信・適時開示で採点。ベンチマーク指数ではなく catalyst の的中で評価。"
          history={jp}
          showTargetDate
        />
      ) : (
        <p className="text-sm text-zinc-500">日本株データを読み込めませんでした。</p>
      )}

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。{" "}
        <Link href="/portfolio" className="text-gold">
          米国株 →
        </Link>
      </p>
    </div>
  );
}
