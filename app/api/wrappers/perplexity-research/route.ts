import { NextRequest, NextResponse } from "next/server";
import { fetchPerplexityResearch } from "@/lib/wrappers";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

interface PerplexityBody {
  ticker?: unknown;
  lookback_hours?: unknown;
}

/**
 * POST /api/wrappers/perplexity-research — x402-paywalled ($0.05) wrapper
 * around Perplexity. PERPLEXITY_API_KEY is server-side only.
 *
 * Paywall via the shared `withPaywall` helper (Section C): advertises BOTH Base
 * and Solana USDC legs and verifies whichever chain the caller pays on.
 * X-Internal-Key callers skip payment.
 */
const handler = async (req: NextRequest): Promise<NextResponse> => {
  let body: PerplexityBody;
  try {
    body = (await req.json()) as PerplexityBody;
  } catch {
    return jsonError(400, "invalid_json", "request body is not valid JSON");
  }

  const out = await fetchPerplexityResearch(body);
  if (!out.ok) {
    console.error(`[perplexity-research] ${out.err.kind}: ${out.err.message}`);
    return jsonError(out.err.status, out.err.kind, out.err.message);
  }
  return new NextResponse(JSON.stringify(out.value, null, 2), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const POST = withPaywall(handler, {
  price: "$0.05",
  description:
    "Perplexity recent-news research for a ticker with catalyst suggestions + citations. Body: { ticker, lookback_hours }.",
  resourcePath: "/api/wrappers/perplexity-research",
});

function jsonError(status: number, code: string, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: code, message }, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
