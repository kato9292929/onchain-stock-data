import { loadRecords, loadSummaries } from "@/lib/solana-stocks-load";
import { selectionRows, selectionSections, type SelectionRow } from "@/lib/selection";
import { GROUPS } from "@/lib/selection-groups";
import { getThemes } from "@/lib/themes";
import { hitRateOf, tally } from "@/lib/hit-rate";
import { PER_CALL_PRICE } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function stats(rows: SelectionRow[]) {
  const counts = tally(rows.filter((r) => r.status === "judged").map((r) => r.result));
  const rate = hitRateOf(counts);
  return {
    counts,
    rate: rate == null ? "—" : `${(rate * 100).toFixed(0)}%`,
    pending: rows.filter((r) => r.status === "active" || r.status === "expired").length,
  };
}

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

/** Selection: every condition, kept in its categories (formerly Selection / Catalysts / Themes). */
export default async function SelectionPage() {
  const [rec, stocks, themes] = await Promise.all([
    loadRecords().catch(() => null),
    loadSummaries().catch(() => null),
    getThemes().catch(() => null),
  ]);
  if (!rec || !themes) return <p className="p-8 text-sm text-slate-400">Couldn&apos;t load the record.</p>;
  const pages = new Set((stocks?.rows ?? []).map((s) => s.ticker.toUpperCase()));
  const rows = selectionRows(rec, new Date().toISOString().slice(0, 10)).map((r) => ({ ...r, has_page: pages.has(r.ticker.toUpperCase()) }));
  const sections = selectionSections(rows, themes.themes, rec);
  const all = stats(rows);

  return (
    <div className="font-inter space-y-10">
      <header className="space-y-3">
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">Selection</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Every condition set on a US or Japanese stock: a number, a threshold and a deadline, judged HIT / PARTIAL / MISS
          against the company&apos;s own filing. One stock&apos;s full record is{" "}
          <span className="font-semibold text-slate-700">{PER_CALL_PRICE.usdc} USDC per call</span> over x402.
        </p>
        <div className="grid max-w-3xl grid-cols-3 gap-3 pt-2 sm:grid-cols-5">
          {(
            [
              ["Hit rate", all.rate, true],
              ["HIT", all.counts.hit, false],
              ["PARTIAL", all.counts.partial, false],
              ["MISS", all.counts.miss, false],
              ["Pending", all.pending, false],
            ] as Array<[string, string | number, boolean]>
          ).map(([label, value, accent]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}>{value}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      </header>

      {GROUPS.map((g) => {
        const mine = sections.filter((s) => s.group === g.id);
        if (mine.length === 0) return null;
        return (
          <section key={g.id} className="space-y-3">
            <h2 className="font-outfit text-xl font-semibold text-[#0a1b33]">{g.label}</h2>
            {mine.map((s) => {
              const st = stats(s.rows);
              return (
                <details key={s.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4 hover:bg-slate-50">
                    <span className="font-outfit text-[15px] font-semibold text-[#0a1b33]">
                      <span className="mr-2 inline-block text-slate-400 transition-transform group-open:rotate-90">›</span>
                      {s.title}
                    </span>
                    <span className="text-[12px] tabular-nums text-slate-500">
                      {s.companies} companies · Hit rate <span className="font-semibold text-[#0a1b33]">{st.rate}</span> · HIT {st.counts.hit} ·
                      PARTIAL {st.counts.partial} · MISS {st.counts.miss} · Pending {st.pending}
                    </span>
                  </summary>
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
                        {s.rows.map((r) => (
                          <tr key={r.id} className="align-top">
                            <td className="px-5 py-3">
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
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
