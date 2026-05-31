import { NextRequest, NextResponse } from "next/server";
import { getPerformanceHistory, getPortfolioHistory, getStockByTicker } from "@/lib/data";
import {
  fetchBenchmarks,
  appendPerformanceRecord,
  writePerformanceHistory,
} from "@/lib/benchmarks";
import { isCronAuthed } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily cron (06:30 JST). Records the Claude portfolio index vs SPY / QQQ,
 * all rebased to 100 at inception. Calls lib/* directly. Data file write is
 * best-effort on Vercel (read-only FS); the record is always returned.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [perf, portfolioHist, benchmarks] = await Promise.all([
    getPerformanceHistory(),
    getPortfolioHistory(),
    fetchBenchmarks(),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  // Benchmark indices need a fixed base price; capture it on first sight.
  const baseSpy = perf.base_spy_price ?? benchmarks.spy?.price;
  const baseQqq = perf.base_qqq_price ?? benchmarks.qqq?.price;
  const spyIndex =
    benchmarks.spy && baseSpy ? (benchmarks.spy.price / baseSpy) * 100 : 100;
  const qqqIndex =
    benchmarks.qqq && baseQqq ? (benchmarks.qqq.price / baseQqq) * 100 : 100;

  // Portfolio index = weighted sum of (current / entry) price relatives,
  // rebased to 100 (weights sum to 100).
  const portfolioIndex = await computePortfolioIndex(portfolioHist);

  const record = {
    date: today,
    portfolio_index: round2(portfolioIndex),
    spy_index: round2(spyIndex),
    qqq_index: round2(qqqIndex),
    portfolio_return_pct: round2(portfolioIndex - 100),
    spy_return_pct: round2(spyIndex - 100),
    qqq_return_pct: round2(qqqIndex - 100),
  };

  const next = {
    ...appendPerformanceRecord(perf, record),
    base_spy_price: baseSpy,
    base_qqq_price: baseQqq,
  };
  const write = await writePerformanceHistory(next);

  return NextResponse.json({
    ok: true,
    date: today,
    persisted: write.persisted,
    persist_reason: write.reason,
    record,
    benchmarks_live: { spy: benchmarks.spy, qqq: benchmarks.qqq },
  });
}

export const GET = handle;
export const POST = handle;

async function computePortfolioIndex(
  portfolioHist: Awaited<ReturnType<typeof getPortfolioHistory>>,
): Promise<number> {
  const current = portfolioHist.current;
  if (!current || current.holdings.length === 0) return 100;

  let weighted = 0;
  let weightSum = 0;
  for (const h of current.holdings) {
    const entry = h.entry_price_usd;
    if (!entry || entry <= 0) continue;
    const stock = await getStockByTicker(h.ticker).catch(() => null);
    const cur = stock?.price_usd ?? entry; // no live price → treat as flat
    weighted += h.weight * (cur / entry);
    weightSum += h.weight;
  }
  if (weightSum <= 0) return 100;
  // weights sum to ~100; normalise to the weight actually used.
  return (weighted / weightSum) * 100;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
