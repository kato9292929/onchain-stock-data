import { NextResponse } from "next/server";
import {
  ASSET_BASE_USDC,
  ASSET_SOLANA_USDC,
  BASE_NETWORK,
  PAY_TO_BASE,
  PAY_TO_SOLANA,
  PUBLIC_BASE_URL,
  resourceUrl,
  SOLANA_NETWORK,
} from "@/lib/x402";
import { corsPreflight } from "@/lib/x402-route";
import { PRICING_USD } from "@/lib/analyst/templates";
import { PREDICT_PRICING_USD } from "@/lib/predict";

export const runtime = "nodejs";
export const dynamic = "force-static";

// USDC has 6 decimals on both Base and Solana, so a dollar amount in cents
// maps to the smallest unit by multiplying by 10_000 ($0.01 → 10_000 base
// units). x402 v2 expects `amount` as a string of base units, not USD.
const USDC_DECIMALS = 6;
function usdToBaseUnits(usd: number): string {
  return Math.round(usd * 10 ** USDC_DECIMALS).toString();
}

interface AcceptLeg {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  resource: string;
}

function dualLegs(resourcePath: string, usd: number): AcceptLeg[] {
  const resource = resourceUrl(resourcePath);
  const amount = usdToBaseUnits(usd);
  return [
    {
      scheme: "exact",
      network: BASE_NETWORK,
      amount,
      asset: ASSET_BASE_USDC,
      payTo: PAY_TO_BASE,
      resource,
    },
    {
      scheme: "exact",
      network: SOLANA_NETWORK,
      amount,
      asset: ASSET_SOLANA_USDC,
      payTo: PAY_TO_SOLANA,
      resource,
    },
  ];
}

function analystLegs(): AcceptLeg[] {
  // /api/analyst prices per `depth` body field — emit one pair of legs per
  // tier so directory crawlers can show all three price points without
  // re-querying. Resource URL stays the same; clients disambiguate by depth.
  const out: AcceptLeg[] = [];
  for (const depth of ["quick", "standard", "deep"] as const) {
    out.push(...dualLegs("/api/analyst", PRICING_USD[depth]));
  }
  return out;
}

function predictLegs(): AcceptLeg[] {
  // /api/predict prices per `depth` body field — one pair of legs per tier.
  const out: AcceptLeg[] = [];
  for (const depth of ["quick", "standard", "deep"] as const) {
    out.push(...dualLegs("/api/predict", PREDICT_PRICING_USD[depth]));
  }
  return out;
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

export function GET(): NextResponse {
  const body = {
    version: 2,
    name: "Onchain Stock Data",
    description:
      "Tokenized stock data APIs for AI agents (xStocks registry, IPO calendar, holders, DEX liquidity, alpha signals, IC memos).",
    operator: "x402 Inc.",
    region: "APAC",
    base_url: PUBLIC_BASE_URL,
    endpoints: [
      {
        path: "/api/stocks",
        method: "GET",
        description:
          "Full xStocks registry with prices, volumes, and venues. `?tokenized=true` filters to onchain-traded names.",
        accepts: dualLegs("/api/stocks", 0.01),
      },
      {
        path: "/api/stocks/:ticker",
        method: "GET",
        description:
          "Single-ticker detail record from the xStocks registry (e.g. /api/stocks/NVDA).",
        accepts: dualLegs("/api/stocks/:ticker", 0.01),
      },
      {
        path: "/api/ipo",
        method: "GET",
        description:
          "Backpack IPOs Onchain calendar (Superstate × Solana).",
        accepts: dualLegs("/api/ipo", 0.01),
      },
      {
        path: "/api/liquidity",
        method: "GET",
        description:
          "Tokenized stock DEX liquidity + price deviation vs underlying.",
        accepts: dualLegs("/api/liquidity", 0.01),
      },
      {
        path: "/api/holders",
        method: "GET",
        description:
          "Tokenized stock holders map + concentration scores.",
        accepts: dualLegs("/api/holders", 0.01),
      },
      {
        path: "/api/alpha-posts",
        method: "GET",
        description:
          "Curated Alpha Signals feed (owner-managed X post list).",
        accepts: dualLegs("/api/alpha-posts", 0.01),
      },
      {
        path: "/api/analyst",
        method: "POST",
        description:
          "Generate an IC memo for a ticker. Body: { ticker, depth: quick|standard|deep }. Price varies by depth — accepts legs cover all three tiers.",
        accepts: analystLegs(),
      },
      {
        path: "/api/predict",
        method: "POST",
        description:
          "Claude buy/hold/sell predictions for multiple tickers. Body: { tickers: string[], horizon: 1w|1m|3m, depth: quick|standard|deep }. Price varies by depth — accepts legs cover all three tiers.",
        accepts: predictLegs(),
      },
    ],
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Cacheable: this descriptor only changes on deploy. CDN can hold it
      // for an hour; clients can revalidate on their own cadence.
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
