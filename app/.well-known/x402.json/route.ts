import { NextResponse } from "next/server";
import {
  ASSET_BASE_SEPOLIA_USDC,
  ASSET_BASE_USDC,
  ASSET_SOLANA_USDC,
  BASE_NETWORK,
  BASE_SEPOLIA_NETWORK,
  PAY_TO_BASE,
  PAY_TO_BASE_SEPOLIA,
  PAY_TO_SOLANA,
  PER_CALL_PRICE,
  PUBLIC_BASE_URL,
  resourceUrl,
  SOLANA_NETWORK,
} from "@/lib/x402";
import { corsPreflight } from "@/lib/x402-route";

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

/**
 * Solana-only accept leg, priced in atomic USDC base units rather than a USD
 * amount. Used by the per-call endpoints, whose price is `PER_CALL_PRICE` —
 * the same constant the routes charge with, so the descriptor cannot drift
 * away from what /api/catalyst/:ticker and /api/edinet/:code actually ask for.
 */
function solanaOnlyLeg(resourcePath: string, baseUnits: string): AcceptLeg[] {
  return [
    {
      scheme: "exact",
      network: SOLANA_NETWORK,
      amount: baseUnits,
      asset: ASSET_SOLANA_USDC,
      payTo: PAY_TO_SOLANA,
      resource: resourceUrl(resourcePath),
    },
  ];
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

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

export function GET(): NextResponse {
  const body = {
    version: 2,
    name: "Onchain Stock Data",
    description:
      "Claude-run equity research for AI agents: weekly US/JP portfolios (holdings + verifiable catalysts) and dated-catalyst scoring. Paid resources settle per call in USDC — $0.01 on Base or Solana for the /api/alpha/* surface, 0.001 USDC on Solana for the per-company /api/catalyst/{ticker} and /api/edinet/{code} lookups. A free, unsigned surface (the MCP server and three JSON endpoints) is listed under `free_endpoints` / `mcp`.",
    operator: "x402 Inc.",
    region: "APAC",
    base_url: PUBLIC_BASE_URL,
    endpoints: [
      {
        path: "/api/alpha/portfolio/current",
        method: "GET",
        description:
          "Claude US Portfolio - current weekly 10-name selection (ticker, weight, thesis).",
        accepts: dualLegs("/api/alpha/portfolio/current", 0.01),
      },
      {
        path: "/api/alpha/portfolio/scorecard",
        method: "GET",
        description:
          "Claude US Portfolio scorecard - catalyst hit-rate + SPY/QQQ cumulative returns.",
        accepts: dualLegs("/api/alpha/portfolio/scorecard", 0.01),
      },
      {
        path: "/api/alpha/jp/portfolio/current",
        method: "GET",
        description:
          "Claude JP Portfolio - current weekly 10-name Japan-equity selection.",
        accepts: dualLegs("/api/alpha/jp/portfolio/current", 0.01),
      },
      {
        path: "/api/alpha/jp/scorecard",
        method: "GET",
        description:
          "Claude JP Portfolio scorecard - catalyst hit-rate (no benchmark index).",
        accepts: dualLegs("/api/alpha/jp/scorecard", 0.01),
      },
      {
        path: "/api/alpha/jp/catalysts",
        method: "GET",
        description: "Claude JP dated catalysts.",
        accepts: dualLegs("/api/alpha/jp/catalysts", 0.01),
      },
      {
        path: "/api/alpha/catalyst/submit",
        method: "POST",
        description:
          "Submit an external catalyst for Claude verdict scoring. Body: { ticker, catalyst_description, target_date, submitter_contact? }.",
        accepts: dualLegs("/api/alpha/catalyst/submit", 0.01),
      },
      {
        path: "/api/alpha/catalyst/:catalyst_id/score",
        method: "GET",
        description:
          "Lookup the Claude verdict for a submitted external catalyst (pending|hit|partial|miss|na).",
        accepts: dualLegs("/api/alpha/catalyst/:catalyst_id/score", 0.01),
      },
      {
        path: "/api/catalyst/:ticker",
        method: "GET",
        description:
          "Per-company catalyst (due date, success/fail condition, status) plus the latest disclosed financials. Settled per call in USDC on Solana; an unknown ticker returns 404 and is not charged.",
        accepts: solanaOnlyLeg("/api/catalyst/:ticker", PER_CALL_PRICE.base_units),
      },
      {
        path: "/api/edinet/:code",
        method: "GET",
        description:
          "Latest EDINET disclosure metadata (filer, doc id/type, submit datetime) and the accounting period for a TSE ticker. Headline figures are not served (financials_available:false). Settled per call in USDC on Solana.",
        accepts: solanaOnlyLeg("/api/edinet/:code", PER_CALL_PRICE.base_units),
      },
    ],

    // Unsigned, no payment. Kept out of `endpoints` so a directory crawler
    // iterating payable resources never meets a zero-accept entry.
    free_endpoints: [
      {
        path: "/api/alpha/catalysts/physical-ai",
        method: "GET",
        description:
          "Physical-AI dated-catalyst scoreboard: overall hit-rate, per-article breakdown, and every scorable condition with its current verdict.",
        url: resourceUrl("/api/alpha/catalysts/physical-ai"),
      },
      {
        path: "/api/catalyst",
        method: "GET",
        description:
          "Index of the companies covered by /api/catalyst/{ticker}: ticker, name, sector, and whether researched data exists. Free preview of the paid resource.",
        url: resourceUrl("/api/catalyst"),
      },
      {
        path: "/api/edinet",
        method: "GET",
        description:
          "Descriptor for /api/edinet/{code}: parameters, price, source attribution and what the paid response contains.",
        url: resourceUrl("/api/edinet"),
      },
    ],

    // Remote MCP server. Free and read-only; no payment, no model call.
    mcp: {
      url: resourceUrl("/api/mcp"),
      transport: "streamable-http",
      auth: "none",
      description:
        "Read-only MCP tools over the same committed research, free and unsigned.",
      tools: ["portfolio_get", "catalysts_list", "scoreboard_get", "signal_get"],
    },

    // Base Sepolia demo. Deliberately NOT in `endpoints`: it settles in
    // testnet USDC, so listing it as a payable mainnet resource would
    // misrepresent it.
    testnet_endpoints: [
      {
        path: "/api/testnet/signal",
        method: "GET",
        description:
          "Paid twin of the free MCP `signal_get` tool, for exercising the 402 -> sign -> 200 loop. TESTNET ONLY — settles in Base Sepolia USDC, not real funds.",
        network: BASE_SEPOLIA_NETWORK,
        asset: ASSET_BASE_SEPOLIA_USDC,
        payTo: PAY_TO_BASE_SEPOLIA,
        price: process.env.X402_TESTNET_SIGNAL_PRICE ?? "$0.05",
        resource: resourceUrl("/api/testnet/signal"),
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
