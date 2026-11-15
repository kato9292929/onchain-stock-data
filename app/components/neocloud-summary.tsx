import Link from "next/link";
import type { FrontRow } from "@/lib/neocloud-page";
import { formatMetric } from "./neocloud-metrics-table";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function metricText(m: NonNullable<FrontRow["metric"]>) {
  if (m.low !== null || m.high !== null) {
    return `${m.low !== null ? formatMetric(m.low, m.unit) : "?"} – ${m.high !== null ? formatMetric(m.high, m.unit) : "?"}`;
  }
  return formatMetric(m.value, m.unit);
}

function Earnings({ r }: { r: FrontRow }) {
  const ne = r.next_earnings;
  if (!ne.date) return null;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-slate-800">{ne.date}</span>{" "}
      <span className={ne.kind === "confirmed" ? "text-emerald-700" : "text-slate-400"}>
        {ne.kind === "confirmed" ? "confirmed" : "estimated"}
      </span>
    </span>
  );
}

/**
 * The front page's neocloud block: up to six companies, the next to report
 * first — each with its current condition and one disclosed number with its
 * document. A company with no recorded number simply has no number shown.
 */
export function NeocloudSummary({
  rows,
  usCount,
  jpCount,
  pricePerCall,
}: {
  rows: FrontRow[];
  usCount: number;
  jpCount: number;
  pricePerCall: number;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 min-w-0">
        <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">
          Neocloud — {usCount} US · {jpCount} Japan{" "}
          <span className="block text-[13px] font-normal text-slate-400 sm:inline">ネオクラウド 米国{usCount}社・日本{jpCount}社</span>
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Per-company power, backlog, guidance and financing from filings — {pricePerCall} USDC per call.
        </p>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.map((r) => (
          <li
            key={r.ticker}
            data-row={r.ticker}
            className="grid grid-cols-1 gap-1 px-4 py-3 text-[13px] md:grid-cols-[minmax(10rem,1.1fr)_minmax(8rem,0.8fr)_minmax(0,2fr)_minmax(9rem,1fr)] md:items-start md:gap-4"
          >
            <div className="min-w-0">
              <span className="font-semibold text-[#0a1b33]">{r.company}</span>{" "}
              <span className="font-mono text-[11px] text-slate-500">{r.ticker}</span>
              <span className="ml-1 text-[10px] text-slate-400">{r.market}</span>
            </div>
            <div className="text-[12px]">
              <Earnings r={r} />
            </div>
            <div className="min-w-0 text-[12px] leading-relaxed text-slate-600">
              {r.condition && (
                <>
                  {r.condition.rule ? (
                    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-700">{r.condition.rule}</span>
                  ) : (
                    <span>{r.condition.question}</span>
                  )}
                  <span className="ml-1 whitespace-nowrap tabular-nums text-slate-400">by {r.condition.target_date}</span>
                </>
              )}
            </div>
            <div className="text-[12px]">
              {r.metric && (
                <a href={r.metric.source_url} target="_blank" rel="noreferrer" className="hover:underline" title={`${r.metric.label}, as of ${r.metric.as_of}`}>
                  <span className="text-slate-500">{r.metric.label}</span>{" "}
                  <span className="font-semibold tabular-nums text-[#0a1b33]">{metricText(r.metric)}</span>{" "}
                  <span className="text-sky-700">{host(r.metric.source_url)}</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link href="/themes/neocloud-us" className="text-sky-700 hover:underline">
          All 18 US →
        </Link>
        <Link href="/themes/neocloud-jp" className="text-sky-700 hover:underline">
          All 5 Japan →
        </Link>
        <Link href="/api/neocloud/digest" className="text-sky-700 hover:underline">
          Filings, last 7 days (API) →
        </Link>
      </p>
    </section>
  );
}

/** The very top: what OSD is, and how much is on record. */
export function SiteIntro({
  companies,
  active,
  judged,
}: {
  companies: number;
  active: number;
  judged: number;
}) {
  const stats: Array<[string, number]> = [
    ["companies covered", companies],
    ["active conditions", active],
    ["judged", judged],
  ];
  return (
    <section className="pt-2">
      <h1 className="font-outfit text-[32px] font-semibold leading-tight tracking-tight text-[#0a1b33] md:text-[44px]">
        Claude-run equity research
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600 md:text-[15px]">
        Dated, numeric catalysts for US and Japanese stocks — each scored HIT / PARTIAL / MISS against the company&apos;s
        own disclosure once its deadline passes. Free to read; agents pay per call in USDC on Solana (x402).
      </p>
      <dl className="mt-4 grid max-w-xl grid-cols-3 gap-2">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="font-outfit text-xl font-semibold tabular-nums text-[#0a1b33]">{n.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
