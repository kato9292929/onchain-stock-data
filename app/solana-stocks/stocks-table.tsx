"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyMint } from "../components/copy-mint";

/** One row per underlying ticker, as sent from the server page. */
export interface StockRow {
  ticker: string;
  name: string;
  tokens: Array<{ issuer: string; symbol: string; mint: string }>;
  /** Only a date a primary source confirmed; otherwise null. */
  next: { date: string } | null;
  conditions: number;
  verdict: { status: string; judged_at: string | null } | null;
}

const PAGE = 100;

export const STATUS_STYLE: Record<string, string> = {
  hit: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  miss: "bg-rose-50 text-rose-700 border-rose-200",
  na: "bg-slate-50 text-slate-500 border-slate-200",
};

type Issuer = "all" | "xStocks" | "Ondo";

export function StocksTable({ rows, today }: { rows: StockRow[]; today: string }) {
  const [q, setQ] = useState("");
  const [issuer, setIssuer] = useState<Issuer>("all");
  const [onlyConditions, setOnlyConditions] = useState(false);
  const [soon, setSoon] = useState(false);
  const [page, setPage] = useState(0);

  const in14 = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out = rows.filter((r) => {
      if (needle && !r.ticker.includes(needle) && !r.name.toUpperCase().includes(needle)) return false;
      if (issuer !== "all" && !r.tokens.some((t) => t.issuer === issuer)) return false;
      if (onlyConditions && r.conditions === 0) return false;
      if (soon && !(r.next && r.next.date >= today && r.next.date <= in14)) return false;
      return true;
    });
    // "Earnings within 14 days" reads best soonest-first; otherwise keep the
    // server's default order (conditions first, then the nearest deadline).
    if (soon) out.sort((a, b) => (a.next!.date < b.next!.date ? -1 : a.next!.date > b.next!.date ? 1 : 0));
    return out;
  }, [rows, q, issuer, onlyConditions, soon, today, in14]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const reset = () => setPage(0);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
      active ? "border-[#0a152d] bg-[#0a152d] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          placeholder="Search ticker or name"
          aria-label="Search ticker or name"
          className="h-9 w-full rounded-full border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400 sm:w-64"
        />
        {(["all", "xStocks", "Ondo"] as Issuer[]).map((v) => (
          <button
            key={v}
            type="button"
            className={chip(issuer === v)}
            onClick={() => {
              setIssuer(v);
              reset();
            }}
          >
            {v === "all" ? "All issuers" : v}
          </button>
        ))}
        <button
          type="button"
          className={chip(onlyConditions)}
          onClick={() => {
            setOnlyConditions(!onlyConditions);
            reset();
          }}
        >
          With conditions
        </button>
        <button
          type="button"
          className={chip(soon)}
          onClick={() => {
            setSoon(!soon);
            reset();
          }}
        >
          Earnings ≤ 14 days
        </button>
        <span className="ml-auto text-[12px] tabular-nums text-slate-400">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Issuer · mint</th>
              <th className="px-4 py-3 font-semibold">Next earnings</th>
              <th className="px-4 py-3 font-semibold">Conditions</th>
              <th className="px-4 py-3 font-semibold">Latest verdict</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.ticker} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link href={`/solana-stocks/${encodeURIComponent(r.ticker)}`} className="font-outfit font-semibold text-[#0a1b33] hover:underline">
                    {r.ticker}
                  </Link>
                  <div className="max-w-[16rem] truncate text-[12px] text-slate-500">{r.name}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {r.tokens.map((t) => (
                      <div key={t.mint} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-[12px] font-semibold text-slate-700">{t.issuer}</span>
                        <CopyMint mint={t.mint} />
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.next ? (
                    <>
                      <div className="text-slate-800">{r.next.date}</div>
                      <div className="text-[11px] text-emerald-600">confirmed</div>
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.conditions > 0 ? (
                    <span className="font-semibold text-[#0a1b33]">{r.conditions}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.verdict ? (
                    <span className="inline-flex items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${STATUS_STYLE[r.verdict.status] ?? STATUS_STYLE.na}`}>
                        {r.verdict.status}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">{r.verdict.judged_at}</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No tokens match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-[12px] text-slate-500">
          <button type="button" className={chip(false)} disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ← Prev
          </button>
          <span className="tabular-nums">
            Page {cur + 1} / {pages}
          </span>
          <button type="button" className={chip(false)} disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
