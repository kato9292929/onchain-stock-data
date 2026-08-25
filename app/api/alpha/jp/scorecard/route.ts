import { NextResponse } from "next/server";
import { getJpPortfolioEvaluations, type PortfolioEvaluation } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scorecard for the Claude JP Portfolio: catalyst hit-rate and the most recent
 * catalyst evaluations. Mirror of the US scorecard minus the benchmark index
 * (JP tracks catalyst verdicts only, not an index). Paid x402 endpoint
 * (Base + Solana USDC); internal callers bypass with `X-Internal-Key`.
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
      evaluated_at: e.evaluated_at,
      evidence_url: e.evidence_url,
      reasoning: e.reasoning,
    }));

  const as_of = new Date().toISOString().slice(0, 10);

  return NextResponse.json({ as_of, hit_rate, recent_evaluations });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Claude JP Portfolio scorecard - catalyst hit-rate (no benchmark index).",
  resourcePath: "/api/alpha/jp/scorecard",
});

export const OPTIONS = () => corsPreflight();
