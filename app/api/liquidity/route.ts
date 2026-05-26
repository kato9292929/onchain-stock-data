import { NextResponse } from "next/server";
import { getLiquidity } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPaywall(
  async () => NextResponse.json(await getLiquidity()),
  {
    price: "$0.01",
    description: "Tokenized stock DEX liquidity + price deviation.",
    resourcePath: "/api/liquidity",
  },
);

export const OPTIONS = () => corsPreflight();
