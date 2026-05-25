import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { withX402 } from "@x402/next";
import {
  aggregateForTicker,
  companyName,
  tickerExists,
} from "@/lib/analyst/data-aggregator";
import { generateAnalystReport } from "@/lib/analyst/generator";
import { fetchSecFilings } from "@/lib/analyst/sec-edgar";
import {
  Depth,
  DEPTHS,
  PRICING_USD,
} from "@/lib/analyst/templates";
import {
  buildRouteConfig,
  isInternalAuthed,
  x402Server,
} from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalystRequestBody {
  ticker?: string;
  depth?: string;
}

export async function POST(req: NextRequest) {
  let body: AnalystRequestBody;
  try {
    body = (await req.clone().json()) as AnalystRequestBody;
  } catch {
    return jsonError(400, "invalid_json", "request body is not valid JSON");
  }

  const ticker = (body.ticker ?? "").trim().toUpperCase();
  const depth = (body.depth ?? "standard") as Depth;

  if (!ticker) return jsonError(400, "missing_ticker", "ticker is required");
  if (!DEPTHS.includes(depth)) {
    return jsonError(
      400,
      "invalid_depth",
      `depth must be one of ${DEPTHS.join(", ")}`,
    );
  }

  const aggregated = await aggregateForTicker(ticker);
  if (!tickerExists(aggregated)) {
    return jsonError(
      404,
      "ticker_not_found",
      `${ticker} not present in /api/stocks or /api/ipo`,
    );
  }

  const internalAuthed = isInternalAuthed(req);
  const priceUsd = PRICING_USD[depth];

  const runAfterPaid = async () =>
    runAnalyst({ ticker, depth }, aggregated, internalAuthed);

  if (internalAuthed) {
    return runAfterPaid();
  }

  // Delegate to v2 withX402 inline; the route config is depth-specific so we
  // build it per call. withX402 returns the 402 challenge when the X-PAYMENT
  // header is missing or invalid, and only invokes the handler once payment is
  // verified.
  const wrapped = withX402(
    runAfterPaid,
    buildRouteConfig(
      `$${priceUsd.toFixed(2)}`,
      `Generate ${depth} IC memo for ${ticker} (aggregates 5 internal endpoints + Claude synthesis).`,
    ),
    x402Server,
  );
  return wrapped(req);
}

async function runAnalyst(
  { ticker, depth }: { ticker: string; depth: Depth },
  aggregated: Awaited<ReturnType<typeof aggregateForTicker>>,
  internalAuthed: boolean,
): Promise<NextResponse> {
  const sec = depth === "quick" ? undefined : await fetchSecFilings(ticker);

  const result = await generateAnalystReport({
    ticker,
    depth,
    aggregated,
    sec,
  });

  if (!result.ok) {
    if (result.err.kind === "missing_api_key") {
      return jsonError(503, "missing_api_key", result.err.message);
    }
    if (result.err.kind === "timeout") {
      return jsonError(504, "timeout", result.err.message);
    }
    if (result.err.kind === "invalid_output") {
      return jsonError(502, "invalid_output", result.err.message, {
        raw_excerpt: result.err.raw,
      });
    }
    return jsonError(502, "claude_error", result.err.message);
  }

  const report = result.report;
  report.ticker = ticker;
  report.depth = depth;
  if (!report.company_name) report.company_name = companyName(aggregated);
  if (!report.sources_called?.length) {
    report.sources_called = aggregated.fetch_endpoints.map((ep) => ({
      endpoint: ep,
      cost_usd: 0,
      data_summary: "internal call (free under the same x402 host)",
    }));
  }
  report.total_cost_usd = internalAuthed ? 0 : PRICING_USD[depth];

  await persistLog(report).catch(() => {});

  return new NextResponse(JSON.stringify(report, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: code, message, ...extra }, null, 2),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

async function persistLog(report: {
  ticker: string;
  depth: string;
  generated_at: string;
}): Promise<void> {
  if (process.env.VERCEL) return;
  const day = (report.generated_at || new Date().toISOString()).slice(0, 10);
  const dir = path.join(process.cwd(), "data", "analyst-logs", day);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${report.ticker}_${report.depth}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2));
}
