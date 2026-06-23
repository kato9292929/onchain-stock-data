import { getHolders } from "@/lib/data";
import { DataBanner } from "../components/data-banner";

const fmtNum = (n: number) => n.toLocaleString("en-US");

export default async function HoldersPage() {
  const data = await getHolders();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Tokenized Stock Holders Map</h1>
        <p className="text-sm text-zinc-400">
          Helius RPC ベースの xStocks 保有者数・上位ホルダー・集中度スコア。
        </p>
      </header>

      <DataBanner
        source={data.source}
        note={data.note}
        updatedAt={data.updated_at}
      />

      <div className="space-y-4">
        {data.tokens.map((t) => (
          <div key={t.token_symbol} className="terminal-card p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <span className="text-gold-bright font-bold">
                  {t.token_symbol}
                </span>
                <span className="text-zinc-500 text-sm ml-2">
                  underlying {t.underlying_ticker}
                </span>
              </div>
              <div className="text-right text-xs">
                <div className="text-zinc-500">holders / supply</div>
                <div>
                  {fmtNum(t.holder_count)} / {fmtNum(t.total_supply)}
                </div>
              </div>
            </div>

            <div className="mb-3 text-xs text-zinc-400">
              <span className="text-zinc-500">concentration:</span>{" "}
              <span
                className={
                  t.concentration_label === "high"
                    ? "text-rose-400"
                    : t.concentration_label === "moderate"
                      ? "text-amber-300"
                      : "text-emerald-400"
                }
              >
                {t.concentration_label}
              </span>{" "}
              <span className="text-zinc-500">
                (score {t.concentration_score.toFixed(2)})
              </span>
            </div>

            <div className="font-mono break-all text-[10px] text-zinc-500 mb-3">
              mint: {t.mint_address}
            </div>

            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr className="text-left">
                  <th className="font-normal py-1">#</th>
                  <th className="font-normal py-1">label</th>
                  <th className="font-normal py-1 text-right">balance</th>
                  <th className="font-normal py-1 text-right">% supply</th>
                </tr>
              </thead>
              <tbody>
                {t.top_holders.map((h) => (
                  <tr
                    key={h.rank}
                    className="border-t border-zinc-800/60"
                  >
                    <td className="py-1 text-zinc-500">{h.rank}</td>
                    <td className="py-1">
                      <div className="text-zinc-100">{h.label}</div>
                      <div className="font-mono text-[10px] text-zinc-500 truncate">
                        {h.address}
                      </div>
                    </td>
                    <td className="py-1 text-right">{fmtNum(h.balance)}</td>
                    <td className="py-1 text-right text-zinc-300">
                      {h.pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
