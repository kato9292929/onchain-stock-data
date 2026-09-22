import { NextRequest, NextResponse } from "next/server";
import {
  withSolanaUsdcMicroPaywall,
  withPublicCors,
  corsPreflight,
} from "@/lib/x402-route";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { PER_CALL_PRICE } from "@/lib/x402";
import { classifyCatalystAccess } from "@/lib/catalyst-access";

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

/** The ticker this request is asking about, from the last path segment. */
function tickerOf(req: NextRequest): string {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();
}

const paidGet = withSolanaUsdcMicroPaywall(handler, {
  // Canonical per-call price (0.001 USDC on Solana mainnet); see PER_CALL_PRICE.
  units: PER_CALL_PRICE.base_units,
  description:
    "Per-company catalyst — dated due_date, success and fail conditions, source URL, plus the latest disclosed financials where the research recorded them. Only companies at stage 'active' (researched) are charged; a company still at 'draft' returns 200 free with no payment required.",
  resourcePath: "/api/catalyst/:ticker",
});

/**
 * A company we cover but have not researched yet is answered FREE.
 *
 * Its row carries nothing a caller could act on — `due_date`,
 * `success_condition`, `fail_condition` and `source` are all null, and only
 * the name/sector are filled, which the free /api/catalyst index already
 * gives away. Charging 0.001 USDC for that, and describing it as a catalyst
 * lookup, would be selling an empty response: 184 of the 197 companies are in
 * this state today. A 404 would be wrong too — the company IS in the
 * universe, it is just not researched yet — so this returns 200 with
 * `researched: false` and says when to come back.
 */
export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();

  const ticker = tickerOf(req);
  const [ir, physicalAi] = await Promise.all([
    getIrFairFile().catch(() => null),
    readExternalCatalysts().catch(() => []),
  ]);
  const access = classifyCatalystAccess(
    ticker,
    ir?.catalysts ?? [],
    physicalAi,
  );

  if (access === "not-found") {
    // 404 here rather than issuing a challenge the buyer would sign only to be
    // told it does not exist. A 4xx from the handler cancels settlement either
    // way, so this costs nobody money — it saves a pointless round-trip.
    return withPublicCors(async () =>
      NextResponse.json({ error: "ticker not found", ticker }, { status: 404 }),
    )(req);
  }

  if (access === "free-draft") {
    const row = (ir?.catalysts ?? []).find(
      (x) => x.ticker.toUpperCase() === ticker,
    )!;
    return withPublicCors(async () =>
      NextResponse.json({
        ticker: row.ticker,
        name: row.company_name,
        market: row.market,
        tse_market: row.tse_market ?? null,
        sector: row.sector,
        stage: row.stage,
        researched: false,
        note: "This company is covered but not researched yet, so there is no dated catalyst to sell. No payment was required. Researched companies (stage 'active') return the full catalyst at 0.001 USDC per call.",
        catalyst: null,
        financials: null,
      }),
    )(req);
  }

  return paidGet(req);
};

export const OPTIONS = corsPreflight;
