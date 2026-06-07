import { NextRequest, NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): NextResponse {
  return new NextResponse(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * GET /api/alpha/catalyst/:catalyst_id/score — verdict lookup for an external
 * submission. Returns `pending` until the daily evaluator judges it. Unknown
 * id → 404. CORS-open.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ catalyst_id: string }> },
) {
  const { catalyst_id } = await params;
  const list = await readExternalCatalysts();
  const c = list.find((x) => x.catalyst_id === catalyst_id);

  if (!c) {
    return json(404, { error: "not_found", catalyst_id });
  }

  return json(200, {
    catalyst_id: c.catalyst_id,
    ticker: c.ticker,
    catalyst_description: c.catalyst_description,
    target_date: c.target_date,
    status: c.status,
    judgement_date: c.judgement_date,
    evidence_urls: c.evidence_urls ?? [],
    reasoning: c.reasoning,
  });
}
