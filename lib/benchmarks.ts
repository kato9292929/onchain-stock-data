import { promises as fs } from "node:fs";
import path from "node:path";
import type { PerformanceHistoryFile, PerformanceRecord } from "@/lib/data";

/**
 * Benchmark price fetch for the daily performance cron. Default provider is
 * Yahoo Finance's public chart endpoint (no key, BENCHMARK_PROVIDER=yahoo).
 * All network access is wrapped — a failed fetch returns null so the cron
 * can degrade gracefully (carry the previous index forward).
 */

export interface Quote {
  symbol: string;
  price: number;
}

export async function fetchBenchmarkQuote(
  symbol: string,
): Promise<Quote | null> {
  const provider = process.env.BENCHMARK_PROVIDER ?? "yahoo";
  if (provider !== "yahoo") {
    console.warn(`[benchmarks] unknown BENCHMARK_PROVIDER=${provider}, skipping`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      {
        signal: controller.signal,
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; osd-cron/1.0)" },
      },
    );
    if (!res.ok) {
      console.warn(`[benchmarks] yahoo ${res.status} for ${symbol}`);
      return null;
    }
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== "number") return null;
    return { symbol, price };
  } catch (err) {
    console.warn(`[benchmarks] fetch failed for ${symbol}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBenchmarks(): Promise<{
  spy: Quote | null;
  qqq: Quote | null;
}> {
  const [spy, qqq] = await Promise.all([
    fetchBenchmarkQuote("SPY"),
    fetchBenchmarkQuote("QQQ"),
  ]);
  return { spy, qqq };
}

const DATA_DIR = path.join(process.cwd(), "data");

export function appendPerformanceRecord(
  file: PerformanceHistoryFile,
  record: PerformanceRecord,
): PerformanceHistoryFile {
  // Replace same-day record if the cron runs twice in a day.
  const records = file.records.filter((r) => r.date !== record.date);
  records.push(record);
  records.sort((a, b) => a.date.localeCompare(b.date));
  return { ...file, updated_at: new Date().toISOString(), records };
}

export async function writePerformanceHistory(
  file: PerformanceHistoryFile,
): Promise<{ persisted: boolean; reason?: string }> {
  try {
    await fs.writeFile(
      path.join(DATA_DIR, "performance-history.json"),
      JSON.stringify(file, null, 2) + "\n",
    );
    return { persisted: true };
  } catch (e) {
    return { persisted: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
