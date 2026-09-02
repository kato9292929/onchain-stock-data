import { NextResponse } from "next/server";
import { withPublicCors, corsPreflight } from "@/lib/x402-route";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { PUBLIC_BASE_URL } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FREE preview: the catalyst company index (ticker / name / sector / whether
 * researched data is available). Per-company detail is the paid x402 resource
 * at /api/catalyst/{ticker}. Static read — no LLM, no market data.
 */
async function handler() {
  const ir = await getIrFairFile().catch(() => null);
  const companies = (ir?.catalysts ?? [])
    .map((c) => ({
      ticker: c.ticker,
      name: c.company_name,
      sector: c.sector,
      researched: c.stage === "active",
    }))
    .sort((a, b) => Number(b.researched) - Number(a.researched) || a.ticker.localeCompare(b.ticker));

  return NextResponse.json({
    source: "onchain-stock-data · catalyst index",
    note: "Free preview. Per-company catalyst + financials is a paid x402 call at /api/catalyst/{ticker}.",
    paid_resource: `${PUBLIC_BASE_URL}/api/catalyst/{ticker}`,
    count: companies.length,
    researched: companies.filter((c) => c.researched).length,
    companies,
  });
}

export const GET = withPublicCors(handler);
export const OPTIONS = corsPreflight;
