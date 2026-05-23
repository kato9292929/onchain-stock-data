import { NextRequest, NextResponse } from "next/server";

const AGENT_UA_PATTERNS = [
  /claude/i,
  /anthropic/i,
  /gpt/i,
  /openai/i,
  /chatgpt/i,
  /^curl\//i,
  /python-requests/i,
  /httpx/i,
  /go-http-client/i,
  /node-fetch/i,
  /axios/i,
  /undici/i,
  /wget/i,
  /bot\b/i,
  /crawler/i,
  /scraper/i,
  /x402/i,
];

export function isAgentRequest(req: NextRequest | Request): boolean {
  const ua =
    (req as NextRequest).headers?.get?.("user-agent") ??
    (req as Request).headers.get("user-agent") ??
    "";
  if (!ua) return true;
  return AGENT_UA_PATTERNS.some((p) => p.test(ua));
}

export interface X402ChallengeOptions {
  resource: string;
  description: string;
  amountUsd?: number;
}

const DEFAULT_PRICE_USD = 0.01;

const PAYMENT_OPTIONS = [
  {
    scheme: "exact",
    network: "base",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    asset_symbol: "USDC",
    asset_decimals: 6,
    payTo: "0x0000000000000000000000000000000000000000",
  },
  {
    scheme: "exact",
    network: "solana",
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    asset_symbol: "USDC",
    asset_decimals: 6,
    payTo: "11111111111111111111111111111111",
  },
];

export function x402ChallengeResponse(opts: X402ChallengeOptions): NextResponse {
  const amountUsd = opts.amountUsd ?? DEFAULT_PRICE_USD;
  const body = {
    x402Version: 1,
    error: "payment_required",
    accepts: PAYMENT_OPTIONS.map((p) => ({
      ...p,
      maxAmountRequired: (amountUsd * 1_000_000).toFixed(0),
      maxAmountRequiredUsd: amountUsd.toFixed(2),
      resource: opts.resource,
      description: opts.description,
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
    })),
    note:
      "This endpoint is free for humans browsing the website. Programmatic clients pay $" +
      amountUsd.toFixed(2) +
      " per request via x402 (Base USDC or Solana USDC).",
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "x-payment-required": "x402",
      "cache-control": "no-store",
    },
  });
}

export function jsonOk<T>(data: T): NextResponse {
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
    },
  });
}
