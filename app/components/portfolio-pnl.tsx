import type { PerformanceRecord } from "@/lib/data";
import { PerformanceChart } from "../alpha/portfolio/components/performance-chart";

/**
 * Profit & Loss for the (US) Claude Portfolio: "what $10,000 invested at the
 * base date would be worth now", vs the same $10k in SPY / QQQ, plus trailing
 * windows and the rebased index chart. Server component — the performance index
 * (`portfolio_index`, rebased 100 at `base_date`) is chained daily from holding
 * closes, so no live pricing is needed here.
 */
const INVEST = 10_000;

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const tone = (n: number) => (n >= 0 ? "text-emerald-400" : "text-red-400");

/** Trailing return (%) over `days` calendar days, from the index series. */
function windowReturn(records: PerformanceRecord[], days: number): number | null {
  const last = records[records.length - 1];
  const t = new Date(`${last.date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - days);
  const targetIso = t.toISOString().slice(0, 10);
  if (records[0].date > targetIso) return null; // not enough history for this window
  let base = records[0];
  for (const r of records) {
    if (r.date <= targetIso) base = r;
    else break;
  }
  if (base.portfolio_index === last.portfolio_index && base === last) return null;
  return (last.portfolio_index / base.portfolio_index - 1) * 100;
}

const WINDOWS: { key: string; days: number }[] = [
  { key: "1D", days: 1 },
  { key: "7D", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
];

function Stat({ label, value, sub, valueTone }: { label: string; value: string; sub?: string; valueTone?: string }) {
  return (
    <div className="terminal-card p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${valueTone ?? "text-zinc-100"}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums ${valueTone ?? "text-zinc-400"}`}>{sub}</div>}
    </div>
  );
}

export function PortfolioPnl({
  records,
  baseDate,
}: {
  records: PerformanceRecord[];
  baseDate: string;
}) {
  if (!records || records.length === 0) {
    return <p className="text-sm text-zinc-500">パフォーマンスデータがありません。</p>;
  }
  const last = records[records.length - 1];
  const pVal = (INVEST * last.portfolio_index) / 100;
  const spyVal = (INVEST * last.spy_index) / 100;
  const qqqVal = (INVEST * last.qqq_index) / 100;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-zinc-200">Profit &amp; Loss</h3>
        <span className="text-xs text-zinc-500">
          {baseDate} に $10,000 投資 · as of {last.date}
        </span>
      </div>

      {/* Headline: $10k in the Claude Portfolio vs the same $10k in SPY / QQQ. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat
          label="Claude Portfolio ($10,000 →)"
          value={fmtUsd(pVal)}
          sub={`${fmtPct(last.portfolio_return_pct)} · ${(pVal - INVEST >= 0 ? "+" : "") + fmtUsd(pVal - INVEST)}`}
          valueTone={tone(last.portfolio_return_pct)}
        />
        <Stat label="SPY ($10,000 →)" value={fmtUsd(spyVal)} sub={fmtPct(last.spy_return_pct)} valueTone={tone(last.spy_return_pct)} />
        <Stat label="QQQ ($10,000 →)" value={fmtUsd(qqqVal)} sub={fmtPct(last.qqq_return_pct)} valueTone={tone(last.qqq_return_pct)} />
      </div>

      {/* Trailing windows (portfolio). Windows without enough history are dashed. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {WINDOWS.map((w) => {
          const r = windowReturn(records, w.days);
          return (
            <span key={w.key} className="text-zinc-500">
              {w.key}:{" "}
              {r === null ? (
                <span className="text-zinc-600">—</span>
              ) : (
                <span className={tone(r)}>{fmtPct(r)}</span>
              )}
            </span>
          );
        })}
      </div>

      <div className="terminal-card p-4">
        <p className="text-xs text-zinc-500 mb-3">
          Profit History — Claude Portfolio vs SPY / QQQ (rebased 100 @ {baseDate})
        </p>
        <PerformanceChart records={records} />
      </div>
    </div>
  );
}
