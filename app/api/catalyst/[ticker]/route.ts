import { NextRequest, NextResponse } from "next/server";
import {
  withSolanaUsdcMicroPaywall,
  withPublicCors,
  corsPreflight,
} from "@/lib/x402-route";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { loadRecords } from "@/lib/solana-stocks-load";
import { catalystAccess, catalystFreeBody, catalystFullBody } from "@/lib/catalyst-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/catalyst/{ticker}            PAID (x402 per-call, 0.001 USDC on
 *                                       Solana mainnet, exact-svm) — every
 *                                       condition set on the company (sectors,
 *                                       Physical AI, US / JP Weekly) with
 *                                       result, evidence, reasoning and
 *                                       history; next earnings from a primary
 *                                       source; financials extracted from the
 *                                       filing (SEC / TDnet XBRL)
 * GET /api/catalyst/{ticker}?view=free  FREE — identity, next earnings,
 *                                       condition counts, latest verdict
 *
 * A covered company with no condition yet (an unresearched draft) has nothing to sell
 * and is answered with the free view, unpaid. An unknown ticker is 404 before
 * any challenge. Static reads of committed files — no market data, no model.
 * The AA weekly buyer (scripts/x402-weekly-buyer.mjs) hits the paid view.
 */

function tickerOf(req: NextRequest): string {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();
}

const today = () => new Date().toISOString().slice(0, 10);

const paidGet = withSolanaUsdcMicroPaywall(
  async (req: NextRequest) => {
    const body = catalystFullBody(tickerOf(req), await loadRecords(), today());
    return body
      ? NextResponse.json(body)
      : NextResponse.json({ error: "ticker not found" }, { status: 404 });
  },
  {
    units: PER_CALL_PRICE.base_units,
    description:
      "Per-company record — every condition this site set on the company (question, target date, result, " +
      "evidence URL, reasoning, verdict history), the next earnings date from a primary source, and the latest " +
      "disclosed financials extracted from the filing (SEC EDGAR XBRL / TDnet 決算短信 XBRL, each value with its " +
      "document URL). Field reference: /docs.",
    resourcePath: "/api/catalyst/:ticker",
  },
);

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  const ticker = tickerOf(req);
  const rec = await loadRecords();
  const access = catalystAccess(ticker, rec);

  if (access === "not-found") {
    return withPublicCors(async () =>
      NextResponse.json({ error: "ticker not found", ticker }, { status: 404 }),
    )(req);
  }
  const wantsFree = new URL(req.url).searchParams.get("view") === "free";
  if (access === "paid" && !wantsFree) return paidGet(req);

  return withPublicCors(async () =>
    NextResponse.json(catalystFreeBody(ticker, rec, today(), PUBLIC_BASE_URL)),
  )(req);
};

export const OPTIONS = corsPreflight;
