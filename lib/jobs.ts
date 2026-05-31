import {
  getPortfolioHistory,
  getPerformanceHistory,
  getStockByTicker,
  type PerformanceRecord,
  type Portfolio,
  type PortfolioHistoryFile,
  type PerformanceHistoryFile,
} from "@/lib/data";
import {
  selectPortfolio,
  appendPortfolio,
  writePortfolioHistory,
  diffHoldings,
} from "@/lib/portfolio";
import {
  fetchBenchmarks,
  appendPerformanceRecord,
  writePerformanceHistory,
} from "@/lib/benchmarks";

/**
 * Portfolio / performance update jobs (ported from Claude-Stock-Portfolio-Watch's
 * lib/jobs.ts). Shared by the manual /api/cron/* routes AND the GitHub Actions
 * scripts (scripts/update-*.ts) — Actions is the authoritative runner because
 * it can git-commit the data files (Vercel's FS is read-only/ephemeral).
 *
 * These call lib/* directly: no HTTP self-call, no circular /api/predict hit,
 * no double charging.
 */

export interface PortfolioUpdateResult {
  ok: boolean;
  week_of?: string;
  portfolio?: Portfolio;
  persisted?: boolean;
  persist_reason?: string;
  error?: string;
}

export async function runPortfolioUpdate(
  opts: { horizon?: string } = {},
): Promise<PortfolioUpdateResult> {
  const weekOf = mondayOf(new Date());
  const horizon = opts.horizon ?? "1m";

  let prev: PortfolioHistoryFile;
  try {
    prev = await getPortfolioHistory();
  } catch {
    prev = {
      source: "claude-portfolio",
      note: "",
      updated_at: new Date().toISOString(),
      current: null,
      history: [],
    };
  }

  const selected = await selectPortfolio({
    weekOf,
    horizon,
    previous: prev.current,
  });
  if (!selected.ok) {
    return { ok: false, week_of: weekOf, error: selected.error };
  }

  const portfolio: Portfolio = {
    ...selected.portfolio,
    changes: diffHoldings(prev.current, selected.portfolio),
  };
  const next = appendPortfolio(prev, portfolio);
  const write = await writePortfolioHistory(next);

  return {
    ok: true,
    week_of: weekOf,
    portfolio,
    persisted: write.persisted,
    persist_reason: write.reason,
  };
}

export interface PerformanceUpdateResult {
  ok: boolean;
  date?: string;
  record?: PerformanceRecord;
  persisted?: boolean;
  persist_reason?: string;
  benchmarks_live?: unknown;
}

export async function runPerformanceUpdate(): Promise<PerformanceUpdateResult> {
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

  const portfolioIndex = await computePortfolioIndex(portfolioHist);

  const record: PerformanceRecord = {
    date: today,
    portfolio_index: round2(portfolioIndex),
    spy_index: round2(spyIndex),
    qqq_index: round2(qqqIndex),
    portfolio_return_pct: round2(portfolioIndex - 100),
    spy_return_pct: round2(spyIndex - 100),
    qqq_return_pct: round2(qqqIndex - 100),
  };

  const next: PerformanceHistoryFile = {
    ...appendPerformanceRecord(perf, record),
    base_spy_price: baseSpy,
    base_qqq_price: baseQqq,
  };
  const write = await writePerformanceHistory(next);

  return {
    ok: true,
    date: today,
    record,
    persisted: write.persisted,
    persist_reason: write.reason,
    benchmarks_live: { spy: benchmarks.spy, qqq: benchmarks.qqq },
  };
}

async function computePortfolioIndex(
  portfolioHist: PortfolioHistoryFile,
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
  return (weighted / weightSum) * 100;
}

/** ISO date (YYYY-MM-DD) of the Monday on or before `d` (UTC). */
export function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
