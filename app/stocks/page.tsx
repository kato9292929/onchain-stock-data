import Link from "next/link";
import { getStocks } from "@/lib/data";
import { DataBanner } from "../components/data-banner";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtBig = (n: number) => {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  return fmtUsd(n);
};
const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";

export default async function StocksPage() {
  const data = await getStocks();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Stock Data Hub</h1>
        <p className="text-sm text-zinc-400">
          xStocks (Backed Finance 発行・Solana 上の tokenized stocks) と
          上場株財務の統合ビュー。
        </p>
      </header>

      <DataBanner
        source={data.source}
        note={data.note}
        updatedAt={data.updated_at}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {data.stocks.map((s) => {
          const tok = s.tokenized_versions[0];
          const dev = tok
            ? ((tok.current_price_usd - s.price_usd) / s.price_usd) * 100
            : null;
          return (
            <Link
              key={s.underlying_ticker}
              href={`/stocks/${s.underlying_ticker}`}
              className="terminal-card p-4 hover:no-underline"
            >
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div className="text-gold-bright font-bold">
                    {s.underlying_ticker}
                    {tok && (
                      <span className="text-zinc-500 text-sm ml-2">
                        / {tok.token_symbol}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-100 text-sm">{s.company_name}</div>
                  <div className="text-zinc-500 text-xs">
                    {s.listing_market}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-zinc-100 font-bold">
                    {fmtUsd(s.price_usd)}
                  </div>
                  <div
                    className={`text-xs ${
                      s.price_change_24h_pct >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {fmtPct(s.price_change_24h_pct)} (24h)
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400 mb-2">
                <div>
                  <div className="text-zinc-500">mcap</div>
                  <div>{fmtBig(s.market_cap_usd)}</div>
                </div>
                <div>
                  <div className="text-zinc-500">vol 24h</div>
                  <div>{fmtBig(s.volume_24h_usd)}</div>
                </div>
                <div>
                  <div className="text-zinc-500">earnings</div>
                  <div>{s.earnings_next_date ?? "n/a"}</div>
                </div>
              </div>
              {tok && (
                <div className="border-t border-zinc-800 pt-2 text-xs text-zinc-400">
                  <div className="flex items-baseline justify-between">
                    <span>
                      <span className="text-gold">{tok.token_symbol}</span>{" "}
                      {fmtUsd(tok.current_price_usd)}
                    </span>
                    {dev !== null && (
                      <span
                        className={
                          Math.abs(dev) < 0.2
                            ? "text-zinc-500"
                            : dev > 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                        }
                      >
                        DEX dev {fmtPct(dev)}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-500 mt-1 truncate">
                    venues: {tok.venues.join(" · ")}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
