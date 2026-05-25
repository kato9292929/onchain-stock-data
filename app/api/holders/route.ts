import { NextResponse } from "next/server";
import { getHolders } from "@/lib/data";
import { withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPaywall(
  async () => NextResponse.json(await getHolders()),
  {
    price: "$0.01",
    description: "Tokenized stock holders map + concentration scores.",
  },
);
