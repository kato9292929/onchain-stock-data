import { NextResponse } from "next/server";
import {
  getJpPortfolioEvaluations,
  getJpPortfolioHistory,
  type PortfolioEvaluation,
} from "@/lib/data";
import { evaluationCoverage } from "@/lib/evaluation-coverage";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scorecard for the Claude JP Portfolio: catalyst hit-rate and the most recent
 * catalyst evaluations. Mirror of the US scorecard minus the benchmark index
 * (JP tracks catalyst verdicts only, not an index). Paid x402 endpoint
 * (Solana USDC); internal callers bypass with `X-Internal-Key`.
 */
/** Sort key: judged evaluations first (newest evaluated_at), then by week. */
function recencyKey(e: PortfolioEvaluation): number {
  if (e.evaluated_at) return Date.parse(e.evaluated_at);
  return Date.parse(`${e.week_of}T00:00:00Z`) - 1e15;
}

const handler = async (): Promise<NextResponse> => {
  const evalsFile = await getJpPortfolioEvaluations();
  const evaluations = evalsFile.evaluations ?? [];

  const hit_rate = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0, total_judged: 0 };
  for (const e of evaluations) {
    if (e.status in hit_rate) {
      hit_rate[e.status as keyof typeof hit_rate] += 1;
    }
  }
  hit_rate.total_judged =
    hit_rate.hit + hit_rate.partial + hit_rate.miss + hit_rate.na;

  const recent_evaluations = [...evaluations]
    .sort((a, b) => recencyKey(b) - recencyKey(a))
    .slice(0, 20)
    .map((e) => ({
      week_of: e.week_of,
      ticker: e.ticker,
      status: e.status,
      catalyst_target_date: e.catalyst_target_date,
      // Always "thesis" for JP — the auto-register carries the free-text
      // thesis in as the condition. Surfaced so callers can align JP and US.
      condition_source: e.condition_source ?? null,
      evaluated_at: e.evaluated_at,
      evidence_url: e.evidence_url,
      reasoning: e.reasoning,
    }));

  // Same three fields as the US scorecard, with the same meanings: `as_of` is
  // when this answer was computed, `last_verdict_at` is how fresh the
  // judgements are, `coverage` is whether anything is being registered at all.
  // JP has always returned today here while US returned its newest verdict —
  // one field name, two meanings across two endpoints of the same product.
  const as_of = new Date().toISOString().slice(0, 10);
  const last_verdict_at =
    recent_evaluations.find((e) => e.evaluated_at)?.evaluated_at?.slice(0, 10) ??
    null;

  // `pending: 0` alone is ambiguous: it means "nothing is waiting", which is
  // also what a severed selection→scoring link looks like. The US scorecard
  // read `pending: 0` for three months while registering nothing. So the
  // answer carries whether every selected week actually reached the scorer.
  const history = await getJpPortfolioHistory().catch(() => null);
  const cov = history
    ? evaluationCoverage(history, evaluations, { asOf: as_of })
    : null;
  const coverage = cov
    ? {
        weeks_checked: cov.weeks.length,
        unregistered: cov.unregistered,
        gap_weeks: cov.gaps.map((g) => g.week_of),
      }
    : null;

  return NextResponse.json({
    as_of,
    last_verdict_at,
    hit_rate,
    coverage,
    recent_evaluations,
  });
};

export const GET = withSolanaOnlyPaywall(handler, {
  price: "$0.01",
  description:
    "Claude JP Portfolio scorecard - catalyst hit-rate and `coverage` (whether every selected week reached the scorer). No benchmark index. `as_of` is when the answer was computed, NOT a freshness signal - read `last_verdict_at` and `coverage.unregistered` for that.",
  resourcePath: "/api/alpha/jp/scorecard",
});

export const OPTIONS = () => corsPreflight();
