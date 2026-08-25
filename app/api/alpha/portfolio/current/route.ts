import { NextResponse } from "next/server";
import { getPortfolioHistory } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current Claude US Portfolio (weekly 10-name selection) as JSON.
 * Paid x402 endpoint (Base + Solana USDC). The free human view is the
 * `/alpha/portfolio` HTML page; internal callers bypass with `X-Internal-Key`.
 */
const handler = async (): Promise<NextResponse> => {
  const data = await getPortfolioHistory();
  return NextResponse.json({
    source: data.source,
    updated_at: data.updated_at,
    note: data.note,
    current: data.current,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Claude US Portfolio - current weekly 10-name selection.",
  resourcePath: "/api/alpha/portfolio/current",
});

export const OPTIONS = () => corsPreflight();
