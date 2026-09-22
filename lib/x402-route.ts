import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import type { RouteConfig } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import type { Price } from "@x402/core/types";
import {
  assertSolanaExactUsdc,
  buildRouteConfig,
  buildSolanaOnlyRouteConfig,
  buildTestnetRouteConfig,
  isInternalAuthed,
  solanaUsdcUnits,
  x402Server,
  x402TestnetServer,
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
/**
 * The x402 protocol version these routes speak. Mirrors the constant
 * @x402/core uses internally to index facilitator-supported kinds.
 */
const X402_VERSION = 2;

/** A RouteConfig's accept legs, always as an array. */
function acceptsOf(routeConfig: RouteConfig): PaymentOption[] {
  const raw = routeConfig.accepts;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/**
 * The accept legs a live facilitator can verify right now.
 *
 * `buildPaymentRequirements` THROWS for a network whose facilitator never
 * reported its supported kinds, and the loop that walks `accepts` does not
 * catch it. So one unreachable facilitator takes down every route advertising
 * a leg on its network — a CDP outage would 500 each dual-leg /api/alpha/*
 * request even while Solana settles normally through PayAI. Filtering to the
 * live legs lets the route keep serving the chain that still works.
 */
export function verifiableAccepts(
  routeConfig: RouteConfig,
  server: Pick<typeof x402Server, "getSupportedKind"> = x402Server,
): PaymentOption[] {
  return acceptsOf(routeConfig).filter((leg) => {
    try {
      return (
        server.getSupportedKind(X402_VERSION, leg.network, leg.scheme) !==
        undefined
      );
    } catch {
      return false;
    }
  });
}

/**
 * True when the SDK failed because a facilitator was unreachable rather than
 * because the request was bad. Message matching is the only signal the SDK
 * offers (both cases throw a plain Error), so anything unrecognised keeps
 * falling through to the generic 500 below.
 */
function isFacilitatorUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return (
    message.includes("Facilitator does not support") ||
    message.includes("no supported payment kinds loaded")
  );
}

export function withX402AndInternal(
  handler: Handler,
  routeConfig: RouteConfig,
  server: typeof x402Server = x402Server,
): (req: NextRequest) => Promise<NextResponse> {
  const buildWrapped = (config: RouteConfig) =>
    withX402(
      async (req: NextRequest) => handler(req),
      config,
      server,
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
  const wrapped = buildWrapped(routeConfig);
  return async (req: NextRequest) => {
    if (req.method === "OPTIONS") return corsPreflight();
    try {
      const res = isInternalAuthed(req)
        ? await handler(req)
        : await wrapped(req);
      return applyCors(res);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "internal server error";

      if (isFacilitatorUnavailable(err)) {
        // One or more facilitators are down (outage, revoked key, exhausted
        // quota). Re-issue the challenge with whatever legs remain verifiable
        // rather than 500-ing a route whose other chain is healthy.
        const live = verifiableAccepts(routeConfig, server);
        const advertised = acceptsOf(routeConfig);
        if (live.length > 0 && live.length < advertised.length) {
          const dropped = advertised
            .filter((leg) => !live.includes(leg))
            .map((leg) => leg.network)
            .join(", ");
          console.warn(
            `[x402] facilitator unavailable for ${dropped} on ${routeConfig.resource ?? "route"} — serving ${live.map((l) => l.network).join(", ")} only`,
          );
          try {
            return applyCors(
              await buildWrapped({ ...routeConfig, accepts: live })(req),
            );
          } catch {
            // Every surviving leg failed too — fall through to 503.
          }
        }
        // Nothing is verifiable: the caller cannot pay right now, and that is
        // a temporary upstream condition, not a bug in their request. 503 +
        // Retry-After tells an agent to come back instead of giving up.
        return applyCors(
          NextResponse.json(
            {
              error: "payment_unavailable",
              message:
                "No payment facilitator is currently reachable; the paid resource cannot be served. Retry shortly.",
            },
            { status: 503, headers: { "Retry-After": "60" } },
          ),
        );
      }

      // Surface a CORS-tagged 500 so browser-based callers can read the
      // failure body. Without this, fetch() reports a generic CORS error
      // and the agent can't tell init failure from a network blip.
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
  opts: { price: Price; description: string; resourcePath: string },
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
  opts: { price: Price; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  return withX402AndInternal(
    handler,
    buildSolanaOnlyRouteConfig(opts.price, opts.description, opts.resourcePath),
  );
}

/**
 * Guarded shortcut for the micro-priced Solana rail (catalyst, edinet, …):
 * builds a single Solana USDC accept at exactly `units` base units and runs the
 * safety valve (`assertSolanaExactUsdc`) at import time, so the endpoint fails
 * closed if network / mint / amount ever drift. Same internal-bypass + CORS as
 * withPaywall. This is the one wrapper the fixed-price Solana endpoints use.
 */
export function withSolanaUsdcMicroPaywall(
  handler: Handler,
  opts: { units: string; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  const rc = buildSolanaOnlyRouteConfig(
    solanaUsdcUnits(opts.units),
    opts.description,
    opts.resourcePath,
  );
  assertSolanaExactUsdc(rc, opts.units); // safety valve: network / mint / == units
  return withX402AndInternal(handler, rc);
}

/**
 * Shortcut: TESTNET paywall for the MCP "agent pays" demo. Presents a single
 * Base Sepolia (eip155:84532) USDC accept and settles via the public x402.org
 * facilitator — a completely separate stack from the mainnet `withPaywall`
 * above (different network, facilitator, and resource server). Same
 * internal-bypass + CORS behaviour. Use only for demo/testnet endpoints.
 */
export function withTestnetPaywall(
  handler: Handler,
  opts: { price: Price; description: string; resourcePath: string },
): (req: NextRequest) => Promise<NextResponse> {
  return withX402AndInternal(
    handler,
    buildTestnetRouteConfig(opts.price, opts.description, opts.resourcePath),
    x402TestnetServer,
  );
}
