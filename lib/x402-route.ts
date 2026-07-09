import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import type { RouteConfig } from "@x402/core/server";
import {
  buildRouteConfig,
  buildSolanaOnlyRouteConfig,
  buildSolanaAcceptsV1,
  isInternalAuthed,
  x402Server,
  X402_VERSION,
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

/** True when the request already carries an x402 payment to settle. */
function hasPayment(req: NextRequest): boolean {
  return (
    !!req.headers.get("x-payment") || !!req.headers.get("payment-signature")
  );
}

/**
 * Solana-ONLY paywall with a SELF-BUILT 402 challenge.
 *
 * Unlike `withPaywall`, the unpaid 402 is assembled by us instead of by
 * `withX402`, so it is pinned to the v1 Solana shape (bare `"solana"` network,
 * `maxAmountRequired`) that our AA client settles against, and can no longer be
 * silently upgraded to v2 by the facilitator's `getSupported()`. The body
 * co-lists a forward-looking v2 leg (CAIP-2 network, `amount`) as a second
 * accept. See `buildSolanaAcceptsV1` for the field-by-field package grounding.
 *
 * Request routing:
 *  - OPTIONS               → 204 + CORS (never touches withX402);
 *  - X-Internal-Key match  → straight to the handler (zero cost);
 *  - already has a payment  → delegate to withX402 for the real verify/settle
 *      (settlement logic is unchanged — we only own the challenge);
 *  - otherwise              → our self-built v1+v2 402.
 *
 * Note: the challenge body stays `x402Version: 1`. A v2-native client is served
 * the v2 leg's fields but sees a v1 envelope; full v2 transport (an
 * `x402Version:2` body / PAYMENT-REQUIRED header) is a separate track and is
 * not synthesised here without a measured production v2 reference.
 */
export function withSolanaOnlyPaywall(
  handler: Handler,
  opts: { price: string; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  const settle = withX402AndInternal(
    handler,
    buildSolanaOnlyRouteConfig(opts.price, opts.description, opts.resourcePath),
  );
  return async (req: NextRequest) => {
    if (req.method === "OPTIONS") return corsPreflight();
    if (isInternalAuthed(req)) return applyCors(await handler(req));
    // Hand any already-paid request to withX402 for verify + settle.
    if (hasPayment(req)) return settle(req);
    // Unpaid: emit our own v1-pinned, v2-co-listed Solana 402.
    const body = {
      x402Version: X402_VERSION,
      accepts: buildSolanaAcceptsV1(
        opts.resourcePath,
        opts.price,
        opts.description,
      ),
      error: "X-PAYMENT header is required",
    };
    return applyCors(NextResponse.json(body, { status: 402 }));
  };
}
