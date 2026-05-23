import { NextRequest } from "next/server";
import { getAlphaPosts } from "@/lib/data";
import { isAgentRequest, jsonOk, x402ChallengeResponse } from "@/lib/x402";

export async function GET(req: NextRequest) {
  if (isAgentRequest(req)) {
    return x402ChallengeResponse({
      resource: new URL(req.url).pathname,
      description: "Curated Alpha Signals feed (owner-managed X post list).",
    });
  }
  return jsonOk(await getAlphaPosts());
}
