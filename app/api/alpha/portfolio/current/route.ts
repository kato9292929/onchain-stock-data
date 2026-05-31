import { NextResponse } from "next/server";
import { getPortfolioHistory } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free public JSON of the current Claude Portfolio (for agents / external
 * tools). No x402 paywall — this is the open, transparent view. CORS-open.
 */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const data = await getPortfolioHistory();
  return new NextResponse(
    JSON.stringify(
      {
        source: data.source,
        updated_at: data.updated_at,
        note: data.note,
        current: data.current,
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60, s-maxage=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}
