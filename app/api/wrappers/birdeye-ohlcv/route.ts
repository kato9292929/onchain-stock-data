import { NextRequest, NextResponse } from "next/server";
import { fetchBirdeyeOhlcv } from "@/lib/wrappers";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

interface BirdeyeBody {
  address?: unknown;
  type?: unknown;
  limit?: unknown;
}

/**
 * POST /api/wrappers/birdeye-ohlcv — x402-paywalled ($0.01) wrapper around
 * Birdeye's OHLCV API. BIRDEYE_API_KEY is used server-side only and never
 * returned.
 *
 * Paywall via the shared `withPaywall` helper (Section C): it advertises BOTH
 * Base USDC and Solana USDC accept legs and verifies whichever chain the caller
 * pays on (CDP facilitator for Base, SOLANA_FACILITATOR_URL for Solana).
 * X-Internal-Key callers skip payment.
 */
const handler = async (req: NextRequest): Promise<NextResponse> => {
  let body: BirdeyeBody;
  try {
    body = (await req.json()) as BirdeyeBody;
  } catch {
    return jsonError(400, "invalid_json", "request body is not valid JSON");
  }

  const out = await fetchBirdeyeOhlcv(body);
  if (!out.ok) {
    console.error(`[birdeye-ohlcv] ${out.err.kind}: ${out.err.message}`);
    return jsonError(out.err.status, out.err.kind, out.err.message);
  }
  return new NextResponse(JSON.stringify(out.value, null, 2), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const POST = withPaywall(handler, {
  price: "$0.01",
  description:
    "Birdeye OHLCV for a Solana token, trimmed to the candle array. Body: { address, type, limit }.",
  resourcePath: "/api/wrappers/birdeye-ohlcv",
});

function jsonError(status: number, code: string, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: code, message }, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
