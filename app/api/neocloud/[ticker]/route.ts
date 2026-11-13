import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywallAt, withPublicCors, corsPreflight } from "@/lib/x402-route";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { loadRecords } from "@/lib/solana-stocks-load";
import { companyFreeBody, companyFullBody, findNeocloudCompany } from "@/lib/neocloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/neocloud/{ticker}            FREE — the latest number per item
 *                                       (contracted / energized MW, backlog,
 *                                       revenue and capex guidance, financing,
 *                                       key contracts), each with its document
 * GET /api/neocloud/{ticker}?view=full  PAID (x402 per-call, 0.001 USDC on
 *                                       Solana) — every number over time, the
 *                                       conditions and verdicts, the documents
 *
 * The 23 neocloud members (US 18, JP 5). Anything else is 404 before any
 * challenge, and the 402 names this ticker's own URL. Static reads only.
 */

function tickerOf(req: NextRequest): string {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").trim().toUpperCase();
}

async function load(req: NextRequest) {
  const rec = await loadRecords();
  const company = findNeocloudCompany(rec.themes, tickerOf(req));
  return { rec, company, today: new Date().toISOString().slice(0, 10) };
}

const paidGet = withSolanaUsdcMicroPaywallAt(
  async (req: NextRequest) => {
    const { rec, company, today } = await load(req);
    if (!company) return NextResponse.json({ error: "not a neocloud company" }, { status: 404 });
    return NextResponse.json(
      companyFullBody({ company, rec, metrics: rec.neocloud, filings: rec.neocloudFilings, today }),
    );
  },
  {
    units: PER_CALL_PRICE.base_units,
    description:
      "One neocloud company in one call: every disclosed number over time (contracted and energized MW, backlog / " +
      "RPO, revenue and capex guidance, financing, key contracts) with the filing URL and date of each, the " +
      "company's conditions and verdicts, and its recent filings. Field reference: /docs.",
    resourceOf: (req) => `/api/neocloud/${encodeURIComponent(tickerOf(req))}?view=full`,
  },
);

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  const { rec, company, today } = await load(req);
  if (!company) {
    return withPublicCors(async () =>
      NextResponse.json({ error: "not a neocloud company", ticker: tickerOf(req) }, { status: 404 }),
    )(req);
  }
  if (new URL(req.url).searchParams.get("view") === "full") return paidGet(req);
  return withPublicCors(async () =>
    NextResponse.json(
      companyFreeBody({ company, rec, metrics: rec.neocloud, filings: rec.neocloudFilings, today }, PUBLIC_BASE_URL),
    ),
  )(req);
};

export const OPTIONS = corsPreflight;
