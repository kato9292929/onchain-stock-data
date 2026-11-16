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
import { cikFor, getSecRecord } from "@/lib/edgar";

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
    const ticker = tickerOf(req);
    const body = fullBody(ticker, file, rec, today, PUBLIC_BASE_URL);
    if (!body) return NextResponse.json({ error: "ticker not found" }, { status: 404 });
    // The company's own SEC filings and XBRL financials (US-listed). If SEC is
    // unreachable the call fails with 502 and is not charged.
    let sec;
    try {
      sec = await getSecRecord(ticker);
    } catch (e) {
      return NextResponse.json({ error: "sec_unavailable", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
    return NextResponse.json({ ...body, sec });
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
  // No condition, but the company files with the SEC: its filings and
  // financials are the full view, so it is sold like any other.
  if (wantsFull && access === "free-only") {
    let sec = null;
    try {
      sec = await cikFor(ticker);
    } catch {
      return withPublicCors(async () => NextResponse.json({ error: "sec_unavailable" }, { status: 503 }))(req);
    }
    if (sec) return paidGet(req);
  }

  // Nothing to sell (no condition and no SEC filer — an ETF or a non-US listing): the free view, unpaid.
  return withPublicCors(async () => NextResponse.json(freeBody(ticker, file, rec, today, PUBLIC_BASE_URL)))(req);
};

export const OPTIONS = corsPreflight;
