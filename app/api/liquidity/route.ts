import { NextRequest, NextResponse } from "next/server";
import { getLiquidity } from "@/lib/data";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (req: NextRequest) => {
  const ticker = new URL(req.url).searchParams.get("ticker") ?? undefined;
  const data = await getLiquidity(ticker);
  if (!data) {
    return NextResponse.json({ error: "not_found", ticker }, { status: 404 });
  }
  return NextResponse.json(data);
};

// Solana-only paywall: 402 advertises a single Solana USDC accept (no Base
// leg) so AA settles this endpoint on Solana. See withSolanaOnlyPaywall.
export const GET = withSolanaOnlyPaywall(handler, {
  price: "$0.01",
  description: "Tokenized stock DEX liquidity + price deviation.",
  resourcePath: "/api/liquidity",
});

export const OPTIONS = () => corsPreflight();
