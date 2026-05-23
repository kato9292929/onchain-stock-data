import { getLiquidity } from "@/lib/data";
import { DataBanner } from "../components/data-banner";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtBig = (n: number) => {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return fmtUsd(n);
};

export default async function LiquidityPage() {
  const data = await getLiquidity();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Tokenized Stock Liquidity Tracker</h1>
        <p className="text-sm text-zinc-400">
          Jupiter / Raydium / Orca プールの TVL、公式価格 vs DEX 価格の
          乖離率、アービトラージ機会。
        </p>
      </header>

      <DataBanner
        source={data.source}
        note={data.note}
        updatedAt={data.updated_at}
      />

      <div className="space-y-3">
        {data.pairs.map((p) => {
          const dev = p.deviation_pct;
          return (
            <div key={p.token_symbol} className="terminal-card p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <span className="text-cyan-300 font-bold">
                    {p.token_symbol}
                  </span>
                  <span className="text-zinc-500 text-sm ml-2">
                    underlying {p.underlying_ticker}
                  </span>
                </div>
                <div className="text-right text-xs">
                  <div className="text-zinc-500">tvl / vol24h</div>
                  <div>
                    {fmtBig(p.tvl_usd)} / {fmtBig(p.volume_24h_usd)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                <div>
                  <div className="text-xs text-zinc-500">official</div>
                  <div>{fmtUsd(p.official_price_usd)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">dex</div>
                  <div>{fmtUsd(p.dex_price_usd)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">deviation</div>
                  <div
                    className={
                      Math.abs(dev) < 0.2
                        ? "text-zinc-300"
                        : dev > 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }
                  >
                    {(dev > 0 ? "+" : "") + dev.toFixed(3)}%
                  </div>
                </div>
              </div>

              <div className="text-xs text-zinc-400 mb-2">
                <span className="text-zinc-500">arb signal:</span>{" "}
                <span
                  className={
                    p.arbitrage_signal.startsWith("premium")
                      ? "text-amber-300"
                      : p.arbitrage_signal.startsWith("discount")
                        ? "text-emerald-300"
                        : "text-zinc-300"
                  }
                >
                  {p.arbitrage_signal}
                </span>
              </div>

              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr className="text-left">
                    <th className="font-normal py-1">venue</th>
                    <th className="font-normal py-1">pair</th>
                    <th className="font-normal py-1 text-right">tvl</th>
                    <th className="font-normal py-1 text-right">fee</th>
                  </tr>
                </thead>
                <tbody>
                  {p.top_pools.map((pool, idx) => (
                    <tr
                      key={`${pool.venue}-${idx}`}
                      className="border-t border-zinc-800/60"
                    >
                      <td className="py-1">{pool.venue}</td>
                      <td className="py-1 text-zinc-300">{pool.pair}</td>
                      <td className="py-1 text-right">{fmtBig(pool.tvl_usd)}</td>
                      <td className="py-1 text-right text-zinc-500">
                        {pool.fee_bps !== null ? `${pool.fee_bps} bps` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
