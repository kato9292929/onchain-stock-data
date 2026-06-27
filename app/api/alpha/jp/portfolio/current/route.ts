import { NextResponse } from "next/server";
import { getJpPortfolioHistory } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free public JSON of the current JP Claude Portfolio (Japanese AI / semi /
 * data-center supply chain). Mirror of /api/alpha/portfolio/current. No x402
 * paywall, CORS-open. This is the canonical JP surface (replaces the older
 * external-catalysts-based /api/alpha/jp/catalysts).
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
  const data = await getJpPortfolioHistory();
  const current = data.current
    ? {
        ...data.current,
        holdings: data.current.holdings.map((h) => ({
          ticker: h.ticker,
          company_name: h.company_name,
          weight: h.weight,
          thesis: h.thesis,
          target_date: h.target_date,
        })),
      }
    : null;

  return new NextResponse(
    JSON.stringify(
      {
        source: data.source,
        updated_at: data.updated_at,
        note: data.note,
        current,
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
