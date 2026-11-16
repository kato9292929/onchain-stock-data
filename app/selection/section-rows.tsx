"use client";

import { useState } from "react";
import type { SelectionRow } from "@/lib/selection-groups";

const PREVIEW = 5;

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function Verdict({ r }: { r: SelectionRow }) {
  if (r.status === "active")
    return <span className="text-slate-500">Pending</span>;
  if (r.status === "expired")
    return <span className="text-slate-500">Awaiting verdict</span>;
  const cls =
    r.result === "hit"
      ? "bg-emerald-50 text-emerald-700"
      : r.result === "miss"
        ? "bg-rose-50 text-rose-700"
        : r.result === "partial"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${cls}`}
    >
      {r.result}
    </span>
  );
}

/** One category's conditions: the first five, then "Show all" opens the rest in place (as on the Stocks list). */
export function SectionRows({ rows, preview = PREVIEW }: { rows: SelectionRow[]; preview?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, preview);
  return (
    <>
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Company</th>
              <th className="px-4 py-2.5 font-semibold">Condition</th>
              <th className="px-4 py-2.5 font-semibold">Due</th>
              <th className="px-4 py-2.5 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-5 py-3">
                  {r.has_page ? (
                    <a
                      href={`/solana-stocks/${encodeURIComponent(r.ticker)}`}
                      className="font-semibold text-sky-700 hover:underline"
                    >
                      {r.ticker}
                    </a>
                  ) : (
                    <span className="font-semibold text-[#0a1b33]">
                      {r.ticker}
                    </span>
                  )}
                  <div className="text-slate-500">{r.company}</div>
                </td>
                <td className="max-w-[560px] px-4 py-3 leading-relaxed text-slate-700">
                  {r.condition}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                  {r.target_date}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <Verdict r={r} />
                    {r.status === "judged" && r.evidence_url && (
                      <a
                        href={r.evidence_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-sky-700 hover:underline"
                      >
                        {host(r.evidence_url)} →
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && rows.length > preview && (
        <div className="flex justify-center border-t border-slate-100 py-3">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-[13px] font-semibold text-[#0a1b33] shadow-sm transition-colors hover:border-slate-300"
          >
            Show all {rows.length.toLocaleString()} ↓
          </button>
        </div>
      )}
    </>
  );
}
