import { NextResponse } from "next/server";
import {
  getPerformanceHistory,
  getPortfolioEvaluations,
  type PortfolioEvaluation,
} from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scorecard for the Claude US Portfolio: catalyst hit-rate, cumulative returns
 * vs SPY/QQQ, and the most recent catalyst evaluations. Paid x402 endpoint
 * (Base + Solana USDC); internal callers bypass with `X-Internal-Key`.
 *
 * `portfolio_index` is now live — chained daily from holding closes and rebased
 * to 100 at `base_date`. `cumulative_returns.portfolio_pct` is `null` only at
 * inception (before any record diverges from the 100 sentinel); real values
 * flow through automatically after that.
 */
const JUDGED: PortfolioEvaluation["status"][] = ["hit", "partial", "miss", "na"];

/** Sort key: judged evaluations first (newest evaluated_at), then by week. */
function recencyKey(e: PortfolioEvaluation): number {
  if (e.evaluated_at) return Date.parse(e.evaluated_at);
  // pending entries have no evaluated_at — order them by target week instead,
  // always below judged ones (negative epoch).
  return Date.parse(`${e.week_of}T00:00:00Z`) - 1e15;
}

const handler = async (): Promise<NextResponse> => {
  const [evalsFile, perf] = await Promise.all([
    getPortfolioEvaluations(),
    getPerformanceHistory(),
  ]);

  const evaluations = evalsFile.evaluations ?? [];

  const hit_rate = {
    hit: 0,
    partial: 0,
    miss: 0,
    na: 0,
    pending: 0,
    total_judged: 0,
  };
  for (const e of evaluations) {
    if (e.status in hit_rate) {
      hit_rate[e.status as keyof typeof hit_rate] += 1;
    }
  }
  hit_rate.total_judged =
    hit_rate.hit + hit_rate.partial + hit_rate.miss + hit_rate.na;

  // Cumulative returns from base to the latest performance record.
  const records = perf.records ?? [];
  const last = records.length > 0 ? records[records.length - 1] : null;
  // portfolio_index is rebased 100 at base_date; surface a real portfolio_pct
  // once any record diverges from the 100 sentinel (i.e. after inception day).
  const portfolioImplemented = records.some((r) => r.portfolio_index !== 100);
  const cumulative_returns = {
    from_date: perf.base_date ?? null,
    to_date: last?.date ?? null,
    portfolio_pct:
      portfolioImplemented && last ? last.portfolio_return_pct : null,
    spy_pct: last?.spy_return_pct ?? null,
    qqq_pct: last?.qqq_return_pct ?? null,
  };

  const recent_evaluations = [...evaluations]
    .sort((a, b) => recencyKey(b) - recencyKey(a))
    .slice(0, 20)
    .map((e) => ({
      week_of: e.week_of,
      ticker: e.ticker,
      status: e.status,
      catalyst_target_date: e.catalyst_target_date,
      evaluated_at: e.evaluated_at,
      evidence_url: e.evidence_url,
      reasoning: e.reasoning,
    }));

  const as_of = last?.date ?? new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    as_of,
    hit_rate,
    cumulative_returns,
    recent_evaluations,
  });
};

void JUDGED;

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Claude US Portfolio scorecard - catalyst hit-rate + SPY/QQQ cumulative returns.",
  resourcePath: "/api/alpha/portfolio/scorecard",
});

export const OPTIONS = () => corsPreflight();
