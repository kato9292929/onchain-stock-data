"use client";

import { useState } from "react";

export interface SunriseRow {
  ticker: string;
  name: string;
  symbol: string;
  mint: string;
  listed_at: string;
  volume_24h_usd: number | null;
  holders: number | null;
}

const usd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`;

/** The Sunrise listings: the newest `preview`, then "Show all" opens the rest in place. */
export function SunriseTable({ rows, preview }: { rows: SunriseRow[]; preview: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, preview);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Listed</th>
              <th className="px-4 py-3 font-semibold">Stock</th>
              <th className="px-4 py-3 text-right font-semibold">24h volume</th>
              <th className="px-4 py-3 text-right font-semibold">Holders</th>
              <th className="px-4 py-3 font-semibold">Mint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.mint}>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{r.listed_at}</td>
                <td className="px-4 py-2.5">
                  <a href={`/solana-stocks/${encodeURIComponent(r.ticker)}`} className="font-semibold text-sky-700 hover:underline">
                    {r.ticker}
                  </a>{" "}
                  <span className="text-slate-500">{r.name}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#0a1b33]">
                  {r.volume_24h_usd == null ? "—" : usd(r.volume_24h_usd)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.holders == null ? "—" : r.holders.toLocaleString("en-US")}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                  {r.mint.slice(0, 6)}…{r.mint.slice(-4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && rows.length > preview && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-[13px] font-semibold text-[#0a1b33] shadow-sm transition-colors hover:border-slate-300"
          >
            Show all {rows.length} ↓
          </button>
        </div>
      )}
    </div>
  );
}
