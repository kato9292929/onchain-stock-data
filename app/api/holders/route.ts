import { NextResponse } from "next/server";
import { getHolders } from "@/lib/data";
import { corsPreflight, withSolanaOnlyPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Solana-only paywall: 402 advertises a single Solana USDC accept (no Base
// leg) so AA settles this endpoint on Solana. See withSolanaOnlyPaywall.
export const GET = withSolanaOnlyPaywall(
  async () => NextResponse.json(await getHolders()),
  {
    price: "$0.01",
    description: "Tokenized stock holders map + concentration scores.",
    resourcePath: "/api/holders",
  },
);

export const OPTIONS = () => corsPreflight();
