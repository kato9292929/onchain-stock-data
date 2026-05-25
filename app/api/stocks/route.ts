import { NextRequest, NextResponse } from "next/server";
import { getStocks } from "@/lib/data";
import { withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const tokenizedOnly = searchParams.get("tokenized") === "true";
  const data = await getStocks();
  const stocks = tokenizedOnly
    ? data.stocks.filter((s) => s.tokenized_versions.length > 0)
    : data.stocks;
  return NextResponse.json({ ...data, stocks });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Full xStocks registry with prices, volumes, and venues.",
});
