import { NextResponse } from "next/server";
import { getIpos } from "@/lib/data";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solana-only paywall: 402 advertises a single Solana USDC accept (no Base
// leg) so AA settles this endpoint on Solana. See withSolanaOnlyPaywall.
export const GET = withSolanaOnlyPaywall(
  async () => NextResponse.json(await getIpos()),
  {
    price: "$0.01",
    description: "Backpack IPOs Onchain calendar (Superstate × Solana).",
    resourcePath: "/api/ipo",
  },
);

export const OPTIONS = () => corsPreflight();
