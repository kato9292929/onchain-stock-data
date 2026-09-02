import { NextRequest, NextResponse } from "next/server";
import { withPaywall, corsPreflight } from "@/lib/x402-route";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { readExternalCatalysts } from "@/lib/external-catalysts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PAID (x402 per-call): one company's catalyst + latest disclosed financials,
 * from our own research (EDINET not used; no market-price/market-cap data).
 * Unsigned → 402; signed → 200. Static read — Anthropic cost 0.
 */
async function handler(req: NextRequest): Promise<NextResponse> {
  // withX402 doesn't forward Next dynamic params — read the last path segment.
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  const ticker = decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();

  const ir = await getIrFairFile().catch(() => null);
  const c = (ir?.catalysts ?? []).find((x) => x.ticker.toUpperCase() === ticker);
  if (c) {
    return NextResponse.json({
      ticker: c.ticker,
      name: c.company_name,
      market: c.market,
      tse_market: c.tse_market ?? null,
      sector: c.sector,
      stage: c.stage,
      business_line: c.business_line ?? null,
      financials: {
        revenue: c.revenue ?? null,
        operating_income: c.operating_income ?? null,
        unit: c.revenue != null ? "JPY_millions" : null,
        fiscal_period: c.fiscal_period ?? null,
        disclosed_at: c.disclosed_at ?? null,
      },
      catalyst: {
        due_date: c.due_date,
        success_condition: c.success_condition,
        fail_condition: c.fail_condition,
        status: c.status,
      },
      source: c.source ?? null,
    });
  }

  // Fallback: Physical-AI series catalysts.
  const pa = await readExternalCatalysts().catch(() => []);
  const p = pa.find((x) => x.ticker.toUpperCase() === ticker);
  if (p) {
    return NextResponse.json({
      ticker: p.ticker,
      name: p.company_name ?? null,
      series: p.series ?? null,
      catalyst: {
        target_date: p.target_date,
        description: p.catalyst_description,
        status: p.status,
        judgement_date: p.judgement_date,
      },
      evidence_urls: p.evidence_urls ?? [],
    });
  }

  return NextResponse.json({ error: "ticker not found", ticker }, { status: 404 });
}

export const GET = withPaywall(handler, {
  price: "$0.02",
  description:
    "Per-company catalyst + latest disclosed financials (research). Settled per call via x402.",
  resourcePath: "/api/catalyst/:ticker",
});

export const OPTIONS = corsPreflight;
