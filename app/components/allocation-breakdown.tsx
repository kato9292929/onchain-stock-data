/**
 * Allocation Breakdown — horizontal weight bars for a portfolio's holdings,
 * sorted by weight. Server component (no interactivity). Used by both the US
 * and JP portfolio pages.
 */
export interface AllocationHolding {
  ticker: string;
  company_name: string;
  weight: number;
}

export function AllocationBreakdown({
  holdings,
  accentTickers,
}: {
  holdings: AllocationHolding[];
  /** Tickers to mark (e.g. Solana-tokenized) with a small dot. */
  accentTickers?: Set<string>;
}) {
  if (!holdings || holdings.length === 0) {
    return <p className="text-sm text-slate-400">No holdings.</p>;
  }
  const rows = [...holdings].sort((a, b) => b.weight - a.weight);
  const max = Math.max(...rows.map((h) => h.weight), 1);

  return (
    <div className="terminal-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-base text-slate-900">Allocation Breakdown</h3>
        <span className="text-xs text-slate-400">{rows.length} holdings</span>
      </div>
      <div className="space-y-2">
        {rows.map((h) => {
          const up = h.ticker.toUpperCase();
          const pct = (h.weight / max) * 100;
          return (
            <div key={h.ticker} className="flex items-center gap-3">
              <div className="w-28 shrink-0 truncate">
                <span className="font-display text-sm text-slate-900">{h.ticker}</span>
                {accentTickers?.has(up) && (
                  <span
                    className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle"
                    title="Solana tokenized"
                  />
                )}
                <div className="text-[11px] text-slate-400 truncate">{h.company_name}</div>
              </div>
              <div className="flex-1 h-5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-14 shrink-0 text-right text-sm text-slate-700 tabular-nums">
                {h.weight.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
