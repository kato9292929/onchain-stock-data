import { NextResponse } from "next/server";
import { getJpPortfolioHistory } from "@/lib/data";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";
import { getEarningsDates, nextEarningsOf } from "@/lib/company-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current Claude JP Portfolio (weekly 10-name Japan-equity selection) as JSON.
 * Paid x402 endpoint (Solana USDC). The free human view is the JP
 * portfolio HTML page; internal callers bypass with `X-Internal-Key`.
 */
const handler = async (): Promise<NextResponse> => {
  const [data, earnings] = await Promise.all([getJpPortfolioHistory(), getEarningsDates()]);
  const today = new Date().toISOString().slice(0, 10);
  const current = data.current
    ? {
        ...data.current,
        holdings: data.current.holdings.map((h) => ({
          ticker: h.ticker,
          company_name: h.company_name,
          weight: h.weight,
          thesis: h.thesis,
          target_date: h.target_date,
          next_earnings: nextEarningsOf(h.ticker, { earnings }, today),
        })),
      }
    : null;

  return NextResponse.json({
    source: data.source,
    updated_at: data.updated_at,
    current,
  });
};

export const GET = withSolanaOnlyPaywall(handler, {
  price: "$0.01",
  description: "Claude JP Portfolio - current weekly 10-name Japan-equity selection.",
  resourcePath: "/api/alpha/jp/portfolio/current",
});

export const OPTIONS = () => corsPreflight();
