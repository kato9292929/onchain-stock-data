import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { fetchPerplexityResearch } from "@/lib/wrappers";
import { buildRouteConfig, isInternalAuthed, x402Server } from "@/lib/x402";
import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  CORS_EXPOSE_HEADERS,
  corsPreflight,
} from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_RESPONSE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
  "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
};

function applyCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_RESPONSE_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

interface PerplexityBody {
  ticker?: unknown;
  lookback_hours?: unknown;
}

/**
 * POST /api/wrappers/perplexity-research — x402-paywalled ($0.05) wrapper
 * around Perplexity. PERPLEXITY_API_KEY is server-side only. Returns the top-3
 * news events + catalyst suggestions and the upstream citations.
 */
export async function POST(req: NextRequest) {
  let body: PerplexityBody;
  try {
    body = (await req.clone().json()) as PerplexityBody;
  } catch {
    return applyCors(jsonError(400, "invalid_json", "request body is not valid JSON"));
  }

  const run = async (): Promise<NextResponse> => {
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

  if (isInternalAuthed(req)) {
    return applyCors(await run());
  }

  const wrapped = withX402(
    run,
    buildRouteConfig(
      "$0.05",
      "Perplexity recent-news research for a ticker with catalyst suggestions + citations. Body: { ticker, lookback_hours }.",
      "/api/wrappers/perplexity-research",
    ),
    x402Server,
    undefined,
    undefined,
    true, // syncFacilitatorOnStart
  );
  return applyCors(await wrapped(req));
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: code, message }, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
