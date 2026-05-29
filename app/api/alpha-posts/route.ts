import { NextResponse } from "next/server";
import { getAlphaPosts } from "@/lib/data";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPaywall(
  async () => NextResponse.json(await getAlphaPosts()),
  {
    price: "$0.01",
    description: "Curated Alpha Signals feed (owner-managed X post list).",
    resourcePath: "/api/alpha-posts",
  },
);

export const OPTIONS = () => corsPreflight();
