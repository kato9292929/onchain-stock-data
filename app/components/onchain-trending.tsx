import Link from "next/link";
import { getSolanaStocks } from "@/lib/solana-stocks";
import { issuerShort } from "@/lib/solana-stocks-load";
import { fetchTopTraded, rankActivity } from "@/lib/onchain-activity";

const usd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3).toLocaleString("en-US")}K`;
const n = (v: number) => v.toLocaleString("en-US");

/**
 * What is trading on Solana right now: the tokenized stocks among the top 100
 * tokens by 24h volume (Jupiter's public token API, cached 15 minutes), with
 * the new listings flagged and the volume by issuer. Hidden when the API is
 * unreachable — the page never waits on it to fail loudly.
 */
export async function OnchainTrending({ limit = 10 }: { limit?: number }) {
  let r;
  try {
    const [file, act] = await Promise.all([getSolanaStocks(), fetchTopTraded()]);
    r = rankActivity(file, act, new Date(), issuerShort);
  } catch {
    return null;
  }
  if (r.top.length === 0) return null;

  return (
    <div className="font-inter">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Onchain · last 24h</div>
          <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">Trading now on Solana</h2>
        </div>
        <span className="text-[12px] text-slate-400">Tokenized stocks among Solana&apos;s top 100 tokens by volume</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="font-outfit text-2xl font-semibold tabular-nums text-[#0a1b33]">{usd(r.total_volume_24h_usd)}</span>
          <span className="text-[12px] text-slate-500">24h volume</span>
          {r.by_issuer.map((b) => (
            <span key={b.issuer} className="text-[12px] tabular-nums text-slate-500">
              {b.issuer} <span className="font-semibold text-[#0a1b33]">{Math.round(b.share * 100)}%</span>
            </span>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-semibold">#</th>
                <th className="py-2 pr-4 font-semibold">Stock</th>
                <th className="py-2 pr-4 text-right font-semibold">24h volume</th>
                <th className="py-2 pr-4 text-right font-semibold">Trades</th>
                <th className="py-2 pr-4 text-right font-semibold">Holders</th>
                <th className="py-2 font-semibold">Issuer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.top.slice(0, limit).map((x, i) => (
                <tr key={x.ticker}>
                  <td className="py-2.5 pr-4 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="py-2.5 pr-4">
                    <Link href={`/solana-stocks/${encodeURIComponent(x.ticker)}`} className="font-semibold text-sky-700 hover:underline">
                      {x.ticker}
                    </Link>{" "}
                    <span className="text-slate-500">{x.name}</span>
                    {x.new_listing_since && (
                      <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">New</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-[#0a1b33]">{usd(x.volume_24h_usd)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{n(x.trades_24h)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                    {n(x.holders)}
                    {x.holder_change_24h_pct != null && Math.abs(x.holder_change_24h_pct) >= 1 && (
                      <span className={`ml-1 text-[11px] ${x.holder_change_24h_pct > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {x.holder_change_24h_pct > 0 ? "+" : ""}
                        {x.holder_change_24h_pct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-slate-500">{x.top_issuer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          {r.source}. Market activity only — not used to judge any condition. Updated every 15 minutes.
        </p>
      </div>
    </div>
  );
}
