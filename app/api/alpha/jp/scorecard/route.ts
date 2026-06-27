import { NextResponse } from "next/server";
import { getJpPortfolioEvaluations, type PortfolioEvaluation } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free public JSON scorecard for the JP Claude Portfolio: catalyst hit-rate and
 * the most recent catalyst evaluations. Mirror of /api/alpha/portfolio/scorecard
 * minus the benchmark index (JP tracks catalyst verdicts only, not an index).
 * CORS-open, no x402 paywall.
 */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** Sort key: judged evaluations first (newest evaluated_at), then by week. */
function recencyKey(e: PortfolioEvaluation): number {
  if (e.evaluated_at) return Date.parse(e.evaluated_at);
  return Date.parse(`${e.week_of}T00:00:00Z`) - 1e15;
}

export async function GET(): Promise<NextResponse> {
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

  return new NextResponse(
    JSON.stringify({ as_of, hit_rate, recent_evaluations }, null, 2),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60, s-maxage=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}
