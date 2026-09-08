import { NextRequest, NextResponse } from "next/server";
import { withPublicCors, corsPreflight } from "@/lib/x402-route";
import { SOURCE_LABEL, PROCESSED_BY, DEFAULT_WINDOW_DAYS } from "@/lib/edinet";
import { PUBLIC_BASE_URL, ASSET_SOLANA_USDC } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FREE index / descriptor for the EDINET per-call endpoint. Mirrors the free
 * /api/catalyst preview: it tells a caller (or a directory crawler) what the
 * paid endpoint costs and how to call it, and carries the same source label so
 * the attribution is visible without paying.
 */
async function handler(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({
    source: SOURCE_LABEL,
    processed_by: PROCESSED_BY,
    fetched_via: "EDINET API v2 (documents.json type=2)",
    cache: "weekly",
    endpoint: `${PUBLIC_BASE_URL}/api/edinet/{code}`,
    param: "code = 4-digit TSE ticker (→ 5-digit securities code) or a 5-digit securities code",
    query: { days: `lookback window, 1–31 (default ${DEFAULT_WINDOW_DAYS})` },
    price: {
      amount_base_units: "1000",
      amount_usdc: 0.001,
      asset: ASSET_SOLANA_USDC,
      network: "solana",
      scheme: "exact",
    },
    example: `${PUBLIC_BASE_URL}/api/edinet/7203`,
  });
}

export const GET = withPublicCors(handler);
export const OPTIONS = corsPreflight;
