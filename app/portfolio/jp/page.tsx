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
        <h3 className="font-display text-base text-white">Catalyst hit-rate</h3>
        <span className="text-xs text-white/45">judged {judged}</span>
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
        Scored by web search of earnings / disclosures 7 days after each deadline.
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
        <h1 className="font-display text-3xl sm:text-4xl text-white">Weekly Selection · JP</h1>
        <p className="text-sm text-white/55 max-w-2xl">
          Ten JP names picked weekly from the AI / semiconductor / data-center
          supply chain. Published at{" "}
          <code className="text-white/75">/api/alpha/jp/portfolio/current</code>.
        </p>
        <PortfolioToggle active="jp" />
      </header>

      {evals && <HitRate counts={counts} />}

      {jp?.current && <AllocationBreakdown holdings={jp.current.holdings} />}

      {jp ? (
        <PortfolioSection
          title="Holdings & thesis"
          subtitle="Scored on earnings / disclosures after each deadline — judged on catalyst hits, not a benchmark index."
          history={jp}
          showTargetDate
        />
      ) : (
        <p className="text-sm text-white/45">Couldn&apos;t load JP data.</p>
      )}

      <p className="text-xs text-white/40">
        Informational only — not investment advice.{" "}
        <Link href="/portfolio" className="text-white underline decoration-white/30 underline-offset-2">
          US →
        </Link>
      </p>
    </div>
  );
}
