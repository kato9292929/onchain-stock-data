import { NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";
import { externalRow } from "@/lib/company-record";

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
 * Paid x402 endpoint (Solana USDC); internal callers bypass with
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
    .map((c) => {
      const r = externalRow(c);
      return {
        id: r.id,
        ticker: r.ticker,
        company: r.company,
        question: r.question,
        fail_direction: r.fail_direction,
        target_date: r.target_date,
        result: r.result,
        judged_at: r.judged_at,
        evidence_url: r.evidence_url,
        evidence_urls: r.evidence_urls,
        reasoning: r.reasoning,
        agent_id: c.agent_id ?? null,
        conviction: c.conviction ?? null,
        source: c.source ?? null,
      };
    });

  return NextResponse.json({
    source: "osd_jp_coverage",
    count: jp.length,
    catalysts: jp,
  });
};

export const GET = withSolanaOnlyPaywall(handler, {
  price: "$0.01",
  description: "Claude JP dated catalysts (legacy back-compat surface).",
  resourcePath: "/api/alpha/jp/catalysts",
});

export const OPTIONS = () => corsPreflight();
