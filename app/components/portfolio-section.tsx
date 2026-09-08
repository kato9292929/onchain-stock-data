import Link from "next/link";
import { DataBanner } from "./data-banner";

/**
 * Shared Claude Portfolio holdings table, used by /portfolio for both the US
 * and JP portfolios. Structurally accepts a Portfolio or a JpPortfolio (the
 * extra/missing fields — entry_price_usd vs target_date — are optional here).
 */
export interface DisplayHolding {
  ticker: string;
  company_name: string;
  weight: number;
  thesis: string;
  target_date?: string;
  entry_price_usd?: number;
}

export interface SectionPortfolio {
  week_of: string;
  generated_at: string;
  model: string;
  horizon: string;
  rationale: string;
  holdings: DisplayHolding[];
}

const fmtUsd = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

function OnchainEnrichment() {
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        Solana tokenized
      </span>
    </span>
  );
}

export function PortfolioSection({
  title,
  subtitle,
  history,
  enrichmentTickers,
  tickerBaseHref,
  showTargetDate = false,
  emptyMessage = "No selection yet this week.",
}: {
  title: string;
  subtitle?: React.ReactNode;
  history: {
    current: SectionPortfolio | null;
    source: string;
    note?: string;
    updated_at: string;
  };
  /** Tickers to decorate with the onchain badge/links (US only). */
  enrichmentTickers?: Set<string>;
  /** When set, the ticker links to `${tickerBaseHref}/${ticker}` (US only). */
  tickerBaseHref?: string;
  /** Show a target_date column instead of the Entry column (JP). */
  showTargetDate?: boolean;
  emptyMessage?: string;
}) {
  const p = history.current;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-display text-xl text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>

      <DataBanner
        source={history.source}
        note={history.note}
        updatedAt={history.updated_at}
      />

      {!p ? (
        <p className="text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <>
          <div className="text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
            <span>week_of: <span className="text-slate-700">{p.week_of}</span></span>
            <span>horizon: <span className="text-slate-700">{p.horizon}</span></span>
            <span>model: <span className="text-slate-700">{p.model}</span></span>
            <span>generated_at: <span className="text-slate-700">{p.generated_at}</span></span>
          </div>

          {p.rationale && (
            <div className="terminal-card p-4 text-sm text-slate-700">
              {p.rationale}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left border-b border-slate-200">
                <tr>
                  <th className="py-2 pr-4">Ticker</th>
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4 text-right">Weight</th>
                  <th className="py-2 pr-4 text-right">
                    {showTargetDate ? "Target" : "Entry"}
                  </th>
                  <th className="py-2">Thesis</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.map((h) => {
                  const up = h.ticker.toUpperCase();
                  return (
                    <tr key={h.ticker} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-4">
                        {tickerBaseHref ? (
                          <Link
                            href={`${tickerBaseHref}/${h.ticker}`}
                            className="font-display text-slate-900"
                          >
                            {h.ticker}
                          </Link>
                        ) : (
                          <span className="font-display text-slate-900">{h.ticker}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-slate-500">
                        <div>{h.company_name}</div>
                        {enrichmentTickers?.has(up) && (
                          <div className="mt-1">
                            <OnchainEnrichment />
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-700">
                        {h.weight.toFixed(1)}%
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-500">
                        {showTargetDate ? (h.target_date || "—") : fmtUsd(h.entry_price_usd)}
                      </td>
                      <td className="py-2 text-slate-500">{h.thesis}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
