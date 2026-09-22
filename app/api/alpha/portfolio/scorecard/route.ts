import { NextResponse } from "next/server";
import {
  getPortfolioEvaluations,
  type PortfolioEvaluation,
} from "@/lib/data";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scorecard for the Claude US Portfolio: catalyst hit-rate and the most recent
 * catalyst evaluations. Paid x402 endpoint (Solana USDC); internal callers
 * bypass with `X-Internal-Key`.
 *
 * NO returns / benchmark comparison. This endpoint used to carry
 * `cumulative_returns` (portfolio vs SPY/QQQ) off data/performance-history.json,
 * but that series stopped at 2026-09-01 when update-performance was disabled —
 * so it was billing callers $0.01 for a frozen number. The product publishes
 * which catalysts were called and how they resolved, not what a portfolio
 * would have returned.
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
  const evalsFile = await getPortfolioEvaluations();

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

  const recent_evaluations = [...evaluations]
    .sort((a, b) => recencyKey(b) - recencyKey(a))
    .slice(0, 20)
    .map((e) => ({
      week_of: e.week_of,
      ticker: e.ticker,
      status: e.status,
      catalyst_target_date: e.catalyst_target_date,
      // "distilled" = the condition was extracted from the thesis by the
      // one-shot backfill; "thesis" = the free-text thesis went in verbatim,
      // as the weekly auto-register does. The two are not equally strict, so
      // split on this before comparing hit-rates across them.
      condition_source: e.condition_source ?? null,
      evaluated_at: e.evaluated_at,
      evidence_url: e.evidence_url,
      reasoning: e.reasoning,
    }));

  // Newest judgement on record, else today — the scorecard is only as fresh as
  // its last evaluation.
  const as_of =
    recent_evaluations.find((e) => e.evaluated_at)?.evaluated_at?.slice(0, 10) ??
    new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    as_of,
    hit_rate,
    recent_evaluations,
  });
};

void JUDGED;

export const GET = withSolanaOnlyPaywall(handler, {
  price: "$0.01",
  description: "Claude US Portfolio scorecard - catalyst hit-rate and recent verdicts (no returns / benchmark data).",
  resourcePath: "/api/alpha/portfolio/scorecard",
});

export const OPTIONS = () => corsPreflight();
