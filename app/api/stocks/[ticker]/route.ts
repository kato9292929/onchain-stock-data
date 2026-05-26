import { NextRequest, NextResponse } from "next/server";
import { getStocks } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (req: NextRequest) => {
  const ticker = new URL(req.url).pathname.split("/").pop() ?? "";
  const data = await getStocks();
  const match = data.stocks.find(
    (s) => s.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!match) {
    return NextResponse.json(
      { error: "not_found", ticker },
      { status: 404 },
    );
  }
  return NextResponse.json({
    source: data.source,
    updated_at: data.updated_at,
    stock: match,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Single-ticker detail record from the xStocks registry.",
  resourcePath: "/api/stocks/:ticker",
});

export const OPTIONS = () => corsPreflight();
