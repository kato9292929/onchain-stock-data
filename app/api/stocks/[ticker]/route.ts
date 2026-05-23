import { NextRequest } from "next/server";
import { getStocks } from "@/lib/data";
import { isAgentRequest, jsonOk, x402ChallengeResponse } from "@/lib/x402";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  if (isAgentRequest(req)) {
    return x402ChallengeResponse({
      resource: new URL(req.url).pathname,
      description: `Detail record for ${ticker.toUpperCase()}.`,
    });
  }
  const data = await getStocks();
  const match = data.stocks.find(
    (s) => s.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!match) {
    return new Response(JSON.stringify({ error: "not_found", ticker }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return jsonOk({ source: data.source, updated_at: data.updated_at, stock: match });
}
