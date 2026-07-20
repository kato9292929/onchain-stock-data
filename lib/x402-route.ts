import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import type { RouteConfig } from "@x402/core/server";
import {
  buildRouteConfig,
  buildSolanaOnlyRouteConfig,
  isInternalAuthed,
  x402Server,
} from "./x402";

type Handler = (req: NextRequest) => Promise<NextResponse> | NextResponse;

// CORS preset shared across every paywalled endpoint and the discovery
// descriptor. Open `Access-Control-Allow-Origin: *` because x402 endpoints
// are public-by-design — payment is the auth, not the origin.
//
// `X-PAYMENT` is the header browser-based agents send to settle. `Content-Type`
// covers POST /api/analyst (application/json). `PAYMENT-REQUIRED` and
// `PAYMENT-RESPONSE` are the v2 challenge / receipt headers, exposed so
// browser fetch() callers can read them after a 402 or a 200+settlement.
export const CORS_ALLOW_HEADERS = "X-PAYMENT, Content-Type, X-Internal-Key";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const CORS_EXPOSE_HEADERS =
  "PAYMENT-REQUIRED, PAYMENT-RESPONSE, payment-required, payment-response";

const CORS_BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
  "Access-Control-Max-Age": "86400",
};

/** Shared OPTIONS handler. Re-export from each route file as `OPTIONS`. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_BASE_HEADERS });
}

/** Add CORS + expose-headers to any outgoing response (200, 402, 5xx). */
function applyCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_BASE_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  res.headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
  return res;
}

/**
 * Wrap a route handler so that:
 * - OPTIONS preflight short-circuits to 204 + CORS (never hits withX402);
 * - callers with a matching `X-Internal-Key` skip payment and hit the handler
 *   directly (zero cost);
 * - everyone else goes through `withX402`, which returns the v2 402 challenge
 *   on unpaid requests and settles payment via the configured facilitator;
 * - every response (200 / 402 / error) carries the CORS headers so
 *   browser-based agents can read the challenge cross-origin.
 */
export function withX402AndInternal(
  handler: Handler,
  routeConfig: RouteConfig,
): (req: NextRequest) => Promise<NextResponse> {
  const wrapped = withX402(
    async (req: NextRequest) => handler(req),
    routeConfig,
    x402Server,
    undefined,
    undefined,
    // syncFacilitatorOnStart MUST be true. In @x402/next 2.13.0,
    // prepareHttpServer().init() short-circuits when this is false and never
    // calls facilitator.initialize(), so getSupportedKind() returns undefined
    // and buildPaymentRequirements throws "Facilitator does not support exact
    // on eip155:8453" → HTTP 500 on every unpaid request. true fetches the
    // supported kinds on startup and lazily re-syncs per request.
    true, // syncFacilitatorOnStart
  );
  return async (req: NextRequest) => {
    if (req.method === "OPTIONS") return corsPreflight();
    try {
      const res = isInternalAuthed(req)
        ? await handler(req)
        : await wrapped(req);
      return applyCors(res);
    } catch (err) {
      // Surface a CORS-tagged 500 so browser-based callers can read the
      // failure body. Without this, fetch() reports a generic CORS error
      // and the agent can't tell init failure from a network blip.
      const message =
        err instanceof Error ? err.message : "internal server error";
      return applyCors(
        NextResponse.json({ error: "internal_error", message }, { status: 500 }),
      );
    }
  };
}

/**
 * Wrap a handler as a FREE public endpoint (no x402 payment): OPTIONS → 204+CORS,
 * every other method → the handler's response with CORS + expose headers, and a
 * CORS-tagged 500 on throw. Use for public track-record surfaces that mirror a
 * free web page. To start charging, swap this for `withPaywall`/`withSolanaOnlyPaywall`.
 */
export function withPublicCors(
  handler: Handler,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    if (req.method === "OPTIONS") return corsPreflight();
    try {
      return applyCors(await handler(req));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "internal server error";
      return applyCors(
        NextResponse.json({ error: "internal_error", message }, { status: 500 }),
      );
    }
  };
}

/** Shortcut: build the standard Base+Solana accepts for `price` and wrap. */
export function withPaywall(
  handler: Handler,
  opts: { price: string; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  return withX402AndInternal(
    handler,
    buildRouteConfig(opts.price, opts.description, opts.resourcePath),
  );
}

/**
 * Shortcut: build Solana-ONLY accepts for `price` and wrap. The 402 challenge
 * presents a single Solana USDC accept (no Base leg), forcing callers onto the
 * Solana settlement path. Same internal-bypass + CORS behaviour as withPaywall.
 */
export function withSolanaOnlyPaywall(
  handler: Handler,
  opts: { price: string; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  return withX402AndInternal(
    handler,
    buildSolanaOnlyRouteConfig(opts.price, opts.description, opts.resourcePath),
  );
}
