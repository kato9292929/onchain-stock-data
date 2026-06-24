import {
  getPortfolioHistory,
  getPerformanceHistory,
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
  fetchQuotes,
  appendPerformanceRecord,
  writePerformanceHistory,
} from "@/lib/benchmarks";
import {
  fetchExternalData,
  formatExternalDataForPrompt,
} from "@/lib/external-data";

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
  used_external_data?: boolean;
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

  // Best-effort external alt-data from AA (10s timeout, degrades to "").
  const externalData = await fetchExternalData();
  const externalContext = formatExternalDataForPrompt(externalData);

  const selected = await selectPortfolio({
    weekOf,
    horizon,
    previous: prev.current,
    externalContext,
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
    used_external_data: externalContext.length > 0,
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
  // If a fetch fails, carry the last index forward instead of snapping to 100.
  const baseSpy = perf.base_spy_price ?? benchmarks.spy?.price;
  const baseQqq = perf.base_qqq_price ?? benchmarks.qqq?.price;
  const spyIndex =
    benchmarks.spy && baseSpy
      ? (benchmarks.spy.price / baseSpy) * 100
      : (lastIndexValue(perf, "spy_index") ?? 100);
  const qqqIndex =
    benchmarks.qqq && baseQqq
      ? (benchmarks.qqq.price / baseQqq) * 100
      : (lastIndexValue(perf, "qqq_index") ?? 100);

  // Portfolio: chain a daily index from current holdings and yesterday's
  // prices. This is rebalance-safe — each day uses that day's holdings/weights
  // — and needs no per-holding cost basis, only the prior close we carry here.
  const holdings = portfolioHist.current?.holdings ?? [];
  const quotes = await fetchQuotes(holdings.map((h) => h.ticker));
  const priceToday: Record<string, number> = {};
  for (const q of quotes) if (q) priceToday[q.symbol] = q.price;

  const lastPrices = perf.last_prices ?? {};
  const prevIndex = lastIndexValue(perf, "portfolio_index") ?? 100;

  let weightedReturn = 0;
  let weightSum = 0;
  for (const h of holdings) {
    const cur = priceToday[h.ticker];
    const prev = lastPrices[h.ticker];
    // Skip tickers added this rebalance (no prior price) or with a failed fetch.
    if (!cur || !prev || prev <= 0) continue;
    weightedReturn += h.weight * (cur / prev - 1);
    weightSum += h.weight;
  }
  const dailyReturn = weightSum > 0 ? weightedReturn / weightSum : 0;
  const portfolioIndex = prevIndex * (1 + dailyReturn);

  // Carry today's prices forward for tomorrow's daily-return calc.
  const nextLastPrices: Record<string, number> = { ...lastPrices };
  for (const h of holdings) {
    if (priceToday[h.ticker]) nextLastPrices[h.ticker] = priceToday[h.ticker];
  }

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
    base_date: perf.base_date || today,
    base_spy_price: baseSpy,
    base_qqq_price: baseQqq,
    last_prices: nextLastPrices,
    source: "live",
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

/** Last recorded value of an index series, or null if no records yet. */
function lastIndexValue(
  perf: PerformanceHistoryFile,
  key: "portfolio_index" | "spy_index" | "qqq_index",
): number | null {
  const recs = perf.records;
  if (!recs.length) return null;
  const v = recs[recs.length - 1][key];
  return typeof v === "number" ? v : null;
}

/** ISO date (YYYY-MM-DD) of the Monday of the current week, in JST. */
export function mondayOf(d: Date): string {
  // The weekly cron fires Sun 21:00 UTC = Mon 06:00 JST. Compute the Monday in
  // JST (UTC+9) so it lands on the current week's Monday, not the previous one.
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.getUTCDay(); // 0=Sun..6=Sat, in JST
  const diff = (day + 6) % 7; // days since Monday
  jst.setUTCDate(jst.getUTCDate() - diff);
  return jst.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
