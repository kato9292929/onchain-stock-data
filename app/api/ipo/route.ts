import { NextResponse } from "next/server";
import { getIpos } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPaywall(
  async () => NextResponse.json(await getIpos()),
  {
    price: "$0.01",
    description: "Backpack IPOs Onchain calendar (Superstate × Solana).",
    resourcePath: "/api/ipo",
  },
);

export const OPTIONS = () => corsPreflight();
