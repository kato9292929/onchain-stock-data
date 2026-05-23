import { NextRequest } from "next/server";
import { getIpos } from "@/lib/data";
import { isAgentRequest, jsonOk, x402ChallengeResponse } from "@/lib/x402";

export async function GET(req: NextRequest) {
  if (isAgentRequest(req)) {
    return x402ChallengeResponse({
      resource: new URL(req.url).pathname,
      description: "Backpack IPOs Onchain calendar (Superstate × Solana).",
    });
  }
  return jsonOk(await getIpos());
}
