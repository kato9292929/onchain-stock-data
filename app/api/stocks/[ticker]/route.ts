import { NextRequest, NextResponse } from "next/server";
import { getStockByTicker } from "@/lib/data";
import { isTokensXyzEnabled } from "@/lib/tokensXyz";
import { withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (req: NextRequest) => {
  const ticker = new URL(req.url).pathname.split("/").pop() ?? "";
  const stock = await getStockByTicker(ticker);
  if (!stock) {
    return NextResponse.json({ error: "not_found", ticker }, { status: 404 });
  }
  return NextResponse.json({
    source: isTokensXyzEnabled() ? "tokens.xyz Assets API" : "sample-data",
    updated_at: new Date().toISOString(),
    stock,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Single-ticker detail record from the xStocks registry.",
});
