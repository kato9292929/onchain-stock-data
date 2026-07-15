import { NextResponse } from "next/server";
import { getJpPortfolioHistory } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current Claude JP Portfolio (weekly 10-name Japan-equity selection) as JSON.
 * Paid x402 endpoint (Base + Solana USDC). The free human view is the JP
 * portfolio HTML page; internal callers bypass with `X-Internal-Key`.
 */
const handler = async (): Promise<NextResponse> => {
  const data = await getJpPortfolioHistory();
  const current = data.current
    ? {
        ...data.current,
        holdings: data.current.holdings.map((h) => ({
          ticker: h.ticker,
          company_name: h.company_name,
          weight: h.weight,
          thesis: h.thesis,
          target_date: h.target_date,
        })),
      }
    : null;

  return NextResponse.json({
    source: data.source,
    updated_at: data.updated_at,
    note: data.note,
    current,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Claude JP Portfolio - current weekly 10-name Japan-equity selection.",
  resourcePath: "/api/alpha/jp/portfolio/current",
});

export const OPTIONS = () => corsPreflight();
