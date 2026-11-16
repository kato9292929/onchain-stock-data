import { loadRecords, loadSummaries } from "@/lib/solana-stocks-load";
import {
  selectionRows,
  selectionSections,
  type SelectionRow,
} from "@/lib/selection";
import { GROUPS } from "@/lib/selection-groups";
import { getThemes } from "@/lib/themes";
import { hitRateOf, tally } from "@/lib/hit-rate";
import { PER_CALL_PRICE } from "@/lib/x402";
import { SectionRows } from "../selection/section-rows";


function stats(rows: SelectionRow[]) {
  const counts = tally(
    rows.filter((r) => r.status === "judged").map((r) => r.result),
  );
  const rate = hitRateOf(counts);
  return {
    counts,
    rate: rate == null ? "—" : `${(rate * 100).toFixed(0)}%`,
    pending: rows.filter((r) => r.status === "active" || r.status === "expired")
      .length,
  };
}

/**
 * Selection: every condition, kept in its categories. The Selection page shows
 * five rows per category; the front page three, with a section heading.
 */
export async function SelectionSection({ preview = 5, onFront = false }: { preview?: number; onFront?: boolean }) {
  const [rec, stocks, themes] = await Promise.all([
    loadRecords().catch(() => null),
    loadSummaries().catch(() => null),
    getThemes().catch(() => null),
  ]);
  if (!rec || !themes)
    return (
      <p className="p-8 text-sm text-slate-400">
        Couldn&apos;t load the record.
      </p>
    );
  const pages = new Set(
    (stocks?.rows ?? []).map((s) => s.ticker.toUpperCase()),
  );
  const rows = selectionRows(rec, new Date().toISOString().slice(0, 10)).map(
    (r) => ({ ...r, has_page: pages.has(r.ticker.toUpperCase()) }),
  );
  const sections = selectionSections(rows, themes.themes, rec);
  const all = stats(rows);
  const H = onFront ? "h2" : "h1";

  return (
    <div className="font-inter space-y-10">
      <header className="space-y-3">
        <H className={onFront ? "font-outfit text-2xl font-semibold text-[#0a1b33]" : "font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl"}>
          Selection
        </H>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Every condition set on a US or Japanese stock: a number, a threshold
          and a deadline, judged HIT / PARTIAL / MISS against the company&apos;s
          own filing. One stock&apos;s full record is{" "}
          <span className="font-semibold text-slate-700">
            {PER_CALL_PRICE.usdc} USDC per call
          </span>{" "}
          over x402.
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
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm"
            >
              <div
                className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}
              >
                {value}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                {label}
              </div>
            </div>
          ))}
        </div>
      </header>

      {GROUPS.map((g) => {
        const mine = sections.filter((s) => s.group === g.id);
        if (mine.length === 0) return null;
        return (
          <section key={g.id} className="space-y-3">
            <h2 className="font-outfit text-xl font-semibold text-[#0a1b33]">
              {g.label}
            </h2>
            {mine.map((s) => {
              const st = stats(s.rows);
              return (
                <div
                  key={s.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4">
                    <span className="font-outfit text-[15px] font-semibold text-[#0a1b33]">
                      {s.title}
                    </span>
                    <span className="text-[12px] tabular-nums text-slate-500">
                      {s.companies} companies · Hit rate{" "}
                      <span className="font-semibold text-[#0a1b33]">
                        {st.rate}
                      </span>{" "}
                      · HIT {st.counts.hit} · PARTIAL {st.counts.partial} · MISS{" "}
                      {st.counts.miss} · Pending {st.pending}
                    </span>
                  </div>
                  <SectionRows rows={s.rows} preview={preview} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
