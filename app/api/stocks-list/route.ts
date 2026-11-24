import { NextResponse } from "next/server";
import { stockTableRows } from "@/lib/stock-table-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FREE: the whole tokenized-stock list as the stocks table shows it (ticker,
 * name, issuers and mints, Sunrise listing date, next confirmed earnings,
 * condition count, latest verdict). The front page shows five rows and fetches
 * this when "Show all" is pressed. Cached at the edge for five minutes.
 */
export async function GET() {
  const { rows, today } = await stockTableRows();
  return NextResponse.json(
    { today, count: rows.length, rows },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
