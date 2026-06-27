import { NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/alpha/jp/catalysts — LEGACY route (external-catalysts based).
 *
 * The canonical JP surface is now the osd-internal Claude Portfolio:
 *   GET /api/alpha/jp/portfolio/current  — weekly 10-name JP selection
 *   GET /api/alpha/jp/scorecard          — catalyst verdicts / hit-rate
 * This endpoint is kept for back-compat and returns whatever JP entries remain
 * in the external-catalysts store; new JP coverage flows through the portfolio.
 *
 * Filters the shared external-catalysts store to `market === "JP"` and returns
 * the prediction, its current verdict, and any verified evidence URLs.
 *
 * NOTE: each catalyst's `target_date` is an ESTIMATE from past reporting
 * cadence, not the company's confirmed earnings date. The judge runs on
 * target_date + GRACE_DAYS so the approximation still resolves; replace the
 * dates with official schedules once each company announces them.
 */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(): Promise<NextResponse> {
  const list = await readExternalCatalysts();
  const jp = list
    .filter((c) => c.market === "JP")
    .map((c) => ({
      catalyst_id: c.catalyst_id,
      ticker: c.ticker,
      catalyst_description: c.catalyst_description,
      target_date: c.target_date,
      status: c.status,
      evidence_urls: c.evidence_urls ?? [],
      evaluated_at: c.judgement_date ?? null,
      agent_id: c.agent_id ?? null,
      conviction: c.conviction ?? null,
      source: c.source ?? null,
    }));

  return new NextResponse(
    JSON.stringify(
      {
        source: "osd_jp_coverage",
        note: "Curated Japan-equity (AI data-center chain) dated catalysts. Judged after target_date + grace by the daily evaluator. Not investment advice.",
        count: jp.length,
        catalysts: jp,
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60, s-maxage=300",
        ...CORS,
      },
    },
  );
}
