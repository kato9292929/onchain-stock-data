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
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
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
        <h2 className="font-display text-xl text-white">{title}</h2>
        {subtitle && <p className="text-sm text-white/55">{subtitle}</p>}
      </div>

      <DataBanner
        source={history.source}
        note={history.note}
        updatedAt={history.updated_at}
      />

      {!p ? (
        <p className="text-sm text-white/45">{emptyMessage}</p>
      ) : (
        <>
          <div className="text-xs text-white/45 flex flex-wrap gap-x-4 gap-y-1">
            <span>week_of: <span className="text-white/75">{p.week_of}</span></span>
            <span>horizon: <span className="text-white/75">{p.horizon}</span></span>
            <span>model: <span className="text-white/75">{p.model}</span></span>
            <span>generated_at: <span className="text-white/75">{p.generated_at}</span></span>
          </div>

          {p.rationale && (
            <div className="terminal-card p-4 text-sm text-white/80">
              {p.rationale}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/45 text-left border-b border-white/10">
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
                    <tr key={h.ticker} className="border-b border-white/5 align-top">
                      <td className="py-2 pr-4">
                        {tickerBaseHref ? (
                          <Link
                            href={`${tickerBaseHref}/${h.ticker}`}
                            className="font-display text-white"
                          >
                            {h.ticker}
                          </Link>
                        ) : (
                          <span className="font-display text-white">{h.ticker}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-white/60">
                        <div>{h.company_name}</div>
                        {enrichmentTickers?.has(up) && (
                          <div className="mt-1">
                            <OnchainEnrichment />
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right text-white/85">
                        {h.weight.toFixed(1)}%
                      </td>
                      <td className="py-2 pr-4 text-right text-white/60">
                        {showTargetDate ? (h.target_date || "—") : fmtUsd(h.entry_price_usd)}
                      </td>
                      <td className="py-2 text-white/60">{h.thesis}</td>
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
