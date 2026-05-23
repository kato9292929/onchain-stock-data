import { NextRequest } from "next/server";
import { getLiquidity } from "@/lib/data";
import { isAgentRequest, jsonOk, x402ChallengeResponse } from "@/lib/x402";

export async function GET(req: NextRequest) {
  if (isAgentRequest(req)) {
    return x402ChallengeResponse({
      resource: new URL(req.url).pathname,
      description: "Tokenized stock DEX liquidity + price deviation.",
    });
  }
  return jsonOk(await getLiquidity());
}
