import { NextRequest, NextResponse } from "next/server";
import { withPublicCors, corsPreflight } from "@/lib/x402-route";
import { SOURCE_LABEL, PROCESSED_BY, FINANCIAL_WINDOW_DAYS } from "@/lib/edinet";
import { PUBLIC_BASE_URL, ASSET_SOLANA_USDC, PER_CALL_PRICE } from "@/lib/x402";

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
    pipeline: "edinet-financials-v1",
    fetched_via: "EDINET API v2 (documents.json type=2 + 書類取得 type=5 CSV)",
    cache: "weekly",
    endpoint: `${PUBLIC_BASE_URL}/api/edinet/{code}`,
    param: "code = 4-digit TSE ticker (→ 5-digit securities code) or a 5-digit securities code",
    query: { days: `report scan window, 1–400 (default ${FINANCIAL_WINDOW_DAYS})` },
    returns:
      "latest disclosure metadata — filer_name, doc_id, doc_type_code, doc_description, submit_datetime and the accounting period. Headline figures (sales / operating_income / net_income) are currently NOT served: extraction is paused for reliability, so they return null with financials_available:false (never fabricated).",
    price: {
      amount_base_units: PER_CALL_PRICE.base_units,
      amount_usdc: PER_CALL_PRICE.usdc,
      asset: ASSET_SOLANA_USDC,
      network: PER_CALL_PRICE.network,
      scheme: PER_CALL_PRICE.scheme,
    },
    example: `${PUBLIC_BASE_URL}/api/edinet/7203`,
  });
}

export const GET = withPublicCors(handler);
export const OPTIONS = corsPreflight;
