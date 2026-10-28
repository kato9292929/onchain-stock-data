import { NextRequest, NextResponse } from "next/server";
import {
  withSolanaUsdcMicroPaywall,
  withPublicCors,
  corsPreflight,
} from "@/lib/x402-route";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { getPortfolioEvaluations, getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getSignals } from "@/lib/signals";
import {
  PAID_DESCRIPTION,
  classifySolanaStockAccess,
  freeBody,
  fullBody,
  getSolanaStocks,
  type Records,
} from "@/lib/solana-stocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/solana-stocks/{ticker}            FREE — issuer, Solana mint, next
 *                                            deadline with its date source
 * GET /api/solana-stocks/{ticker}?view=full  PAID (x402 per-call, 0.001 USDC on
 *                                            Solana) — every condition with
 *                                            verdict, verdict_history, evidence;
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

async function load() {
  const [file, usHistory, usEvals, externals, signals] = await Promise.all([
    getSolanaStocks(),
    getPortfolioHistory().catch(() => null),
    getPortfolioEvaluations().catch(() => null),
    readExternalCatalysts().catch(() => []),
    getSignals().catch(() => null),
  ]);
  const rec: Records = { usHistory, usEvals, externals, signals };
  return { file, rec, today: new Date().toISOString().slice(0, 10) };
}

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
      NextResponse.json(
        { error: "ticker not found", ticker, note: "Not issued on Solana by xStocks or Ondo Global Markets as of the last weekly refresh." },
        { status: 404 },
      ),
    )(req);
  }
  if (wantsFull && access === "paid") return paidGet(req);

  return withPublicCors(async () =>
    NextResponse.json({
      ...freeBody(ticker, file, rec, today, PUBLIC_BASE_URL),
      ...(wantsFull
        ? {
            note: "This ticker has no condition on record, so there is no full view to sell. No payment was required.",
          }
        : {}),
    }),
  )(req);
};

export const OPTIONS = corsPreflight;
