import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import {
  PREDICT_DEPTHS,
  PREDICT_HORIZONS,
  PREDICT_MAX_TICKERS,
  PREDICT_PRICING_USD,
  runPredict,
  type PredictDepth,
  type PredictHorizon,
} from "@/lib/predict";
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

interface PredictRequestBody {
  tickers?: unknown;
  horizon?: unknown;
  depth?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PredictRequestBody;
  try {
    body = (await req.clone().json()) as PredictRequestBody;
  } catch {
    return applyCors(jsonError(400, "invalid_json", "request body is not valid JSON"));
  }

  const depth = (typeof body.depth === "string" ? body.depth : "standard") as PredictDepth;
  const horizon = (typeof body.horizon === "string" ? body.horizon : "1m") as PredictHorizon;

  if (!PREDICT_DEPTHS.includes(depth)) {
    return applyCors(
      jsonError(400, "invalid_depth", `depth must be one of ${PREDICT_DEPTHS.join(", ")}`),
    );
  }
  if (!PREDICT_HORIZONS.includes(horizon)) {
    return applyCors(
      jsonError(400, "invalid_horizon", `horizon must be one of ${PREDICT_HORIZONS.join(", ")}`),
    );
  }

  const tickers = normalizeTickers(body.tickers);
  if (tickers.length === 0) {
    return applyCors(jsonError(400, "missing_tickers", "tickers must be a non-empty string array"));
  }
  const max = PREDICT_MAX_TICKERS[depth];
  if (tickers.length > max) {
    return applyCors(
      jsonError(
        400,
        "too_many_tickers",
        `depth=${depth} allows up to ${max} tickers (received ${tickers.length})`,
      ),
    );
  }

  const internalAuthed = isInternalAuthed(req);
  const priceUsd = PREDICT_PRICING_USD[depth];

  const runAfterPaid = async (): Promise<NextResponse> => {
    const out = await runPredict({ tickers, horizon, depth, internalAuthed });
    if (!out.ok) {
      const status =
        out.err.kind === "missing_api_key"
          ? 503
          : out.err.kind === "timeout"
            ? 504
            : 502;
      return jsonError(status, out.err.kind, out.err.message, out.err.raw ? { raw_excerpt: out.err.raw } : {});
    }
    return new NextResponse(JSON.stringify(out.result, null, 2), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  };

  if (internalAuthed) {
    return applyCors(await runAfterPaid());
  }

  // Per-depth pricing → build the route config per call (same pattern as
  // /api/analyst). syncFacilitatorOnStart MUST be true so the SDK fetches
  // supported kinds and the 402 challenge can be built (see lib/x402-route.ts).
  const wrapped = withX402(
    runAfterPaid,
    buildRouteConfig(
      `$${priceUsd.toFixed(2)}`,
      `Claude ${depth} prediction for ${tickers.length} ticker(s) over ${horizon} (buy/hold/sell + confidence, synthesised from osd internal data).`,
      "/api/predict",
    ),
    x402Server,
    undefined,
    undefined,
    true, // syncFacilitatorOnStart
  );
  return applyCors(await wrapped(req));
}

function normalizeTickers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const up = t.trim().toUpperCase();
    if (up && !seen.has(up)) {
      seen.add(up);
      out.push(up);
    }
  }
  return out;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return new NextResponse(JSON.stringify({ error: code, message, ...extra }, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
