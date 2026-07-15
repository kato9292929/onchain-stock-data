import { NextRequest, NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/alpha/catalyst/:catalyst_id/score — verdict lookup for an external
 * submission. Returns `pending` until the daily evaluator judges it. Unknown id
 * → 404 (a 404 cancels x402 settlement, so an unknown-id lookup is not charged).
 * Paid x402 endpoint (Base + Solana USDC); internal callers bypass with
 * `X-Internal-Key`.
 */
const handler = async (req: NextRequest): Promise<NextResponse> => {
  // Path is /api/alpha/catalyst/<id>/score — the id is the second-to-last
  // segment (withX402 doesn't forward the Next.js dynamic-route params).
  const parts = new URL(req.url).pathname.split("/");
  const catalyst_id = parts[parts.length - 2] ?? "";

  const list = await readExternalCatalysts();
  const c = list.find((x) => x.catalyst_id === catalyst_id);

  if (!c) {
    return NextResponse.json({ error: "not_found", catalyst_id }, { status: 404 });
  }

  return NextResponse.json({
    catalyst_id: c.catalyst_id,
    ticker: c.ticker,
    catalyst_description: c.catalyst_description,
    target_date: c.target_date,
    status: c.status,
    judgement_date: c.judgement_date,
    evidence_urls: c.evidence_urls ?? [],
    reasoning: c.reasoning,
  });
};

export const GET = withPaywall(handler, {
  price: "$0.01",
  description: "Lookup the Claude verdict for a submitted external catalyst.",
  resourcePath: "/api/alpha/catalyst/:catalyst_id/score",
});

export const OPTIONS = () => corsPreflight();
