import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, corsPreflight } from "@/lib/x402-route";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { readExternalCatalysts } from "@/lib/external-catalysts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PAID (x402 per-call, Solana mainnet exact-svm): one company's catalyst +
 * latest disclosed financials, from our own research (EDINET not used; no
 * market-price/market-cap data). Unsigned → 402; signed → 200. Static read —
 * Anthropic cost 0.
 *
 * Priced at 1000 USDC base units = 0.001 USDC (6 decimals), settled in
 * USDC-SPL on Solana mainnet only. The AA weekly buyer
 * (scripts/x402-weekly-buyer.mjs) hits this for the whole roster so every
 * per-call payment lands as an on-chain tx verifiable on Solscan.
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

export const GET = withSolanaUsdcMicroPaywall(handler, {
  // 1000 base units = 0.001 USDC (6 decimals) on Solana mainnet. Kept above the
  // facilitator's gas-sponsorship floor so a dust payment isn't rejected (0.0001
  // < sponsored SOL gas → facilitator refuses; 0.001 clears it).
  units: "1000",
  description:
    "Per-company catalyst + latest disclosed financials (research). Settled per call in USDC on Solana (exact-svm).",
  resourcePath: "/api/catalyst/:ticker",
});

export const OPTIONS = corsPreflight;
