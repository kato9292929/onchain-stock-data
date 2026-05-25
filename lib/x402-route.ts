import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import type { RouteConfig } from "@x402/core/server";
import { buildRouteConfig, isInternalAuthed, x402Server } from "./x402";

type Handler = (req: NextRequest) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a route handler so that:
 * - callers with a matching `X-Internal-Key` skip payment and hit the handler
 *   directly (zero cost);
 * - everyone else goes through `withX402`, which returns the v2 402 challenge
 *   on unpaid requests and settles payment via the configured facilitator.
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
    false, // syncFacilitatorOnStart — defer to first paid request
  );
  return async (req: NextRequest) => {
    if (isInternalAuthed(req)) {
      return handler(req);
    }
    return wrapped(req);
  };
}

/** Shortcut: build the standard Base+Solana accepts for `price` and wrap. */
export function withPaywall(
  handler: Handler,
  opts: { price: string; description: string },
): (req: NextRequest) => Promise<NextResponse> {
  return withX402AndInternal(
    handler,
    buildRouteConfig(opts.price, opts.description),
  );
}
