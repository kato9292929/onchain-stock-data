import { NextRequest } from "next/server";
import { getStocks } from "@/lib/data";
import { isAgentRequest, jsonOk, x402ChallengeResponse } from "@/lib/x402";

export async function GET(req: NextRequest) {
  if (isAgentRequest(req)) {
    return x402ChallengeResponse({
      resource: new URL(req.url).pathname,
      description: "Full xStocks registry with prices, volumes, and venues.",
    });
  }
  const { searchParams } = new URL(req.url);
  const tokenizedOnly = searchParams.get("tokenized") === "true";
  const data = await getStocks();
  const stocks = tokenizedOnly
    ? data.stocks.filter((s) => s.tokenized_versions.length > 0)
    : data.stocks;
  return jsonOk({ ...data, stocks });
}
