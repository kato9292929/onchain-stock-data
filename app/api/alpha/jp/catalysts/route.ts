import { NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

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
 * Paid x402 endpoint (Base + Solana USDC); internal callers bypass with
 * `X-Internal-Key`.
 *
 * NOTE: each catalyst's `target_date` is an ESTIMATE from past reporting
 * cadence, not the company's confirmed earnings date. The judge runs on
 * target_date + GRACE_DAYS so the approximation still resolves; replace the
 * dates with official schedules once each company announces them.
 */
const handler = async (): Promise<NextResponse> => {
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

  return NextResponse.json({
    source: "osd_jp_coverage",
    note: "Curated Japan-equity (AI data-center chain) dated catalysts. Judged after target_date + grace by the daily evaluator. Not investment advice.",
    count: jp.length,
    catalysts: jp,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Claude JP dated catalysts (legacy back-compat surface).",
  resourcePath: "/api/alpha/jp/catalysts",
});

export const OPTIONS = () => corsPreflight();
