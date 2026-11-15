"use client";

import { useMemo, useState } from "react";
import { hitRateOf, tally } from "@/lib/hit-rate";
import { GROUPS, type Group, type SelectionRow } from "@/lib/selection-groups";

const PAGE = 50;
type Status = "all" | "judged" | "pending";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function Verdict({ r }: { r: SelectionRow }) {
  if (r.status === "active") return <span className="text-slate-500">Pending</span>;
  if (r.status === "expired") return <span className="text-slate-500">Awaiting verdict</span>;
  const cls =
    r.result === "hit"
      ? "bg-emerald-50 text-emerald-700"
      : r.result === "miss"
        ? "bg-rose-50 text-rose-700"
        : r.result === "partial"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${cls}`}>{r.result}</span>;
}

export function SelectionTable({ rows }: { rows: SelectionRow[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "all">("all");
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (group === "all" || r.group === group) &&
        (status === "all" || (status === "judged" ? r.status === "judged" : r.status === "active" || r.status === "expired")) &&
        (!needle || r.ticker.toLowerCase().includes(needle) || r.company.toLowerCase().includes(needle)),
    );
  }, [rows, q, group, status]);

  const counts = useMemo(() => tally(filtered.filter((r) => r.status === "judged").map((r) => r.result)), [filtered]);
  const rate = hitRateOf(counts);
  const pending = filtered.filter((r) => r.status === "active" || r.status === "expired").length;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * PAGE, cur * PAGE + PAGE);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
      active ? "border-[#0a152d] bg-[#0a152d] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
    }`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {(
          [
            ["Hit rate", rate == null ? "—" : `${(rate * 100).toFixed(0)}%`, true],
            ["HIT", counts.hit, false],
            ["PARTIAL", counts.partial, false],
            ["MISS", counts.miss, false],
            ["Pending", pending, false],
          ] as Array<[string, string | number, boolean]>
        ).map(([label, value, accent]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}>{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Search ticker or name"
          aria-label="Search ticker or name"
          className="h-9 w-full rounded-full border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400 sm:w-56"
        />
        {([{ id: "all", label: "All" }, ...GROUPS] as Array<{ id: Group | "all"; label: string }>).map((g) => (
          <button
            key={g.id}
            type="button"
            className={chip(group === g.id)}
            onClick={() => {
              setGroup(g.id);
              setPage(0);
            }}
          >
            {g.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {(["all", "judged", "pending"] as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            className={chip(status === s)}
            onClick={() => {
              setStatus(s);
              setPage(0);
            }}
          >
            {s === "all" ? "Any status" : s === "judged" ? "Judged" : "Pending"}
          </button>
        ))}
        <span className="ml-auto text-[12px] tabular-nums text-slate-400">{filtered.length.toLocaleString()} conditions</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold">Condition</th>
              <th className="px-4 py-3 font-semibold">Due</th>
              <th className="px-4 py-3 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3">
                  {r.has_page ? (
                    <a href={`/solana-stocks/${encodeURIComponent(r.ticker)}`} className="font-semibold text-sky-700 hover:underline">
                      {r.ticker}
                    </a>
                  ) : (
                    <span className="font-semibold text-[#0a1b33]">{r.ticker}</span>
                  )}
                  <div className="text-slate-500">{r.company}</div>
                </td>
                <td className="max-w-[560px] px-4 py-3 leading-relaxed text-slate-700">{r.condition}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.target_date}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <Verdict r={r} />
                    {r.status === "judged" && r.evidence_url && (
                      <a href={r.evidence_url} target="_blank" rel="noreferrer" className="text-[11px] text-sky-700 hover:underline">
                        {host(r.evidence_url)} →
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No conditions match.
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
