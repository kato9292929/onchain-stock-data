import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, withPublicCors, corsPreflight } from "@/lib/x402-route";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { loadRecords } from "@/lib/solana-stocks-load";
import { digestFreeBody, digestFullBody } from "@/lib/neocloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/neocloud/digest            FREE — the neocloud companies with a
 *                                     filing or a newly recorded number in the
 *                                     last 7 days
 * GET /api/neocloud/digest?view=full  PAID (x402 per-call, 0.001 USDC on
 *                                     Solana) — those filings, the summaries
 *                                     recorded from them, and each new number
 *                                     beside the one before it
 */

async function input() {
  const rec = await loadRecords();
  return {
    themes: rec.themes,
    metrics: rec.neocloud,
    filings: rec.neocloudFilings,
    signals: rec.signals,
    today: new Date().toISOString().slice(0, 10),
  };
}

const paidGet = withSolanaUsdcMicroPaywall(
  async () => NextResponse.json(digestFullBody(await input())),
  {
    units: PER_CALL_PRICE.base_units,
    description:
      "The last 7 days of neocloud disclosures in one call: each company's filings (SEC EDGAR / TDnet) with URLs, " +
      "the summaries recorded from them, and every newly recorded number beside the previous one (MW, backlog, " +
      "guidance, financing, contracts). Field reference: /docs.",
    resourcePath: "/api/neocloud/digest?view=full",
  },
);

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (new URL(req.url).searchParams.get("view") === "full") return paidGet(req);
  return withPublicCors(async () => NextResponse.json(digestFreeBody(await input(), PUBLIC_BASE_URL)))(req);
};

export const OPTIONS = corsPreflight;
