import { NextRequest, NextResponse } from "next/server";
import {
  withSolanaUsdcMicroPaywall,
  withPublicCors,
  corsPreflight,
} from "@/lib/x402-route";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { loadSolanaStocks } from "@/lib/solana-stocks-load";
import {
  PAID_DESCRIPTION,
  classifySolanaStockAccess,
  freeBody,
  fullBody,
} from "@/lib/solana-stocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/solana-stocks/{ticker}            FREE — issuer, Solana mint, next
 *                                            earnings (primary source), condition
 *                                            counts, latest verdict
 * GET /api/solana-stocks/{ticker}?view=full  PAID (x402 per-call, 0.001 USDC on
 *                                            Solana) — every condition with
 *                                            result, evidence, reasoning and
 *                                            history; disclosed financials;
 *                                            recent signals
 *
 * Static reads of committed files — no market data, no model call. A ticker
 * with no condition has nothing to sell, so its full view is answered free
 * (same policy as /api/catalyst/{ticker} for unresearched companies); an
 * unknown ticker is 404 before any challenge is issued.
 */

function tickerOf(req: NextRequest): string {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();
}

const load = loadSolanaStocks;

const paidGet = withSolanaUsdcMicroPaywall(
  async (req: NextRequest) => {
    const { file, rec, today } = await load();
    const body = fullBody(tickerOf(req), file, rec, today, PUBLIC_BASE_URL);
    return body
      ? NextResponse.json(body)
      : NextResponse.json({ error: "ticker not found" }, { status: 404 });
  },
  {
    units: PER_CALL_PRICE.base_units,
    description: PAID_DESCRIPTION,
    resourcePath: "/api/solana-stocks/:ticker?view=full",
  },
);

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  const ticker = tickerOf(req);
  const wantsFull = new URL(req.url).searchParams.get("view") === "full";

  let loaded;
  try {
    loaded = await load();
  } catch {
    return withPublicCors(async () =>
      NextResponse.json({ error: "token list unavailable" }, { status: 503 }),
    )(req);
  }
  const { file, rec, today } = loaded;
  const access = classifySolanaStockAccess(ticker, file, rec);

  if (access === "not-found") {
    return withPublicCors(async () =>
      NextResponse.json({ error: "ticker not found", ticker }, { status: 404 }),
    )(req);
  }
  if (wantsFull && access === "paid") return paidGet(req);

  // A ticker with no condition has no full view to sell: the free view, unpaid.
  return withPublicCors(async () => NextResponse.json(freeBody(ticker, file, rec, today, PUBLIC_BASE_URL)))(req);
};

export const OPTIONS = corsPreflight;
