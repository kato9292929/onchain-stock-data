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

export function OPTIONS(): NextResponse {
  return corsPreflight();
}

export function GET(): NextResponse {
  const body = {
    version: 2,
    name: "Onchain Stock Data",
    description:
      "Claude-run equity research for AI agents: weekly US/JP portfolios (holdings + verifiable catalysts, hit-rate vs SPY/QQQ) and dated-catalyst scoring. The Physical-AI catalyst scoreboard is free at /api/alpha/catalysts/physical-ai.",
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
