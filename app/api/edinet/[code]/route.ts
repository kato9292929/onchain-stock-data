import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, corsPreflight } from "@/lib/x402-route";
import {
  getRecentDocumentsForCompany,
  DEFAULT_WINDOW_DAYS,
  SOURCE_LABEL,
  PROCESSED_BY,
} from "@/lib/edinet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PAID (x402 per-call, Solana mainnet exact-svm — same rail as /api/catalyst):
 * one company's recent EDINET disclosures (metadata) by securities/TSE code.
 *
 * Terms compliance: every payload carries `source` = "出典：金融庁 EDINET" and
 * `processed_by` (we filter by securities code and reshape the v2
 * documents.json; original filings unchanged). Data is fetched only via the
 * official EDINET API v2 and each date list is cached weekly.
 *
 * Priced at 1000 USDC base units (0.001 USDC), settled in USDC-SPL on Solana.
 */
async function handler(req: NextRequest): Promise<NextResponse> {
  // withX402 doesn't forward Next dynamic params — read the last path segment.
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  const code = decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();
  const days = Math.min(
    31,
    Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_WINDOW_DAYS),
  );

  try {
    const { sec_code, documents } = await getRecentDocumentsForCompany(code, days);
    return NextResponse.json({
      source: SOURCE_LABEL,
      processed_by: PROCESSED_BY,
      fetched_via: "EDINET API v2 (documents.json type=2)",
      cache: "weekly",
      code,
      sec_code,
      window_days: days,
      count: documents.length,
      documents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "edinet error";
    return NextResponse.json(
      { error: "edinet_unavailable", message, source: SOURCE_LABEL },
      { status: 502 },
    );
  }
}

export const GET = withSolanaUsdcMicroPaywall(handler, {
  units: "1000",
  description:
    "One company's recent EDINET disclosures (出典：金融庁 EDINET). Settled per call in USDC on Solana (exact-svm).",
  resourcePath: "/api/edinet/:code",
});

export const OPTIONS = corsPreflight;
