import Link from "next/link";

export interface NeocloudSummaryProps {
  markets: Array<{
    market: "US" | "JP";
    theme: string;
    title: string;
    companies: number;
    contracted_power_mw: number;
    contracted_companies: number;
    energized_mw: number;
    energized_companies: number;
  }>;
  disclosures: { count: number; companies: number; from: string; to: string };
  nextReporters: Array<{ ticker: string; company: string; date: string }>;
  pricePerCall: number;
}

const mwText = (v: number, n: number) => (n > 0 ? `${Math.round(v).toLocaleString("en-US")} MW` : "—");

/** The front page's first block: the neocloud companies' power, recent filings and next reporters. */
export function NeocloudSummary({ markets, disclosures, nextReporters, pricePerCall }: NeocloudSummaryProps) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Neocloud</div>
          <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">
            ネオクラウド：米国{markets.find((m) => m.market === "US")?.companies ?? 0}社・日本
            {markets.find((m) => m.market === "JP")?.companies ?? 0}社
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Contracted and energized power, backlog, guidance, financing and contracts — every number as a filing
            states it, with the document. {pricePerCall} USDC per company per call.
          </p>
        </div>
        <Link href="/api/neocloud/digest" className="text-sm font-semibold text-[#0a152d] hover:underline">
          Last 7 days (API) →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {markets.map((m) => (
          <Link
            key={m.market}
            href={`/themes/${m.theme}`}
            className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.title}</div>
            <dl className="mt-2 space-y-2 text-[13px]">
              <div>
                <dt className="text-slate-500">Contracted power</dt>
                <dd className="font-outfit text-2xl font-semibold tabular-nums text-[#0a1b33]">
                  {mwText(m.contracted_power_mw, m.contracted_companies)}
                </dd>
                <dd className="text-[11px] text-slate-400">
                  {m.contracted_companies} of {m.companies} companies disclose
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Energized</dt>
                <dd className="font-outfit text-xl font-semibold tabular-nums text-[#0a1b33]">
                  {mwText(m.energized_mw, m.energized_companies)}
                </dd>
                <dd className="text-[11px] text-slate-400">
                  {m.energized_companies} of {m.companies} companies disclose
                </dd>
              </div>
            </dl>
          </Link>
        ))}
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filings, last 7 days</div>
          <div className="mt-2 font-outfit text-3xl font-semibold tabular-nums text-[#0a1b33]">{disclosures.count}</div>
          <div className="text-[12px] text-slate-500">
            from {disclosures.companies} {disclosures.companies === 1 ? "company" : "companies"} · {disclosures.from} –{" "}
            {disclosures.to}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">SEC EDGAR and TDnet</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next to report</div>
          {nextReporters.length === 0 ? (
            <p className="mt-2 text-[13px] text-slate-400">No confirmed date yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {nextReporters.map((r) => (
                <li key={r.ticker} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-[12px] text-slate-500">{r.ticker}</span> {r.company}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-emerald-700">{r.date}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-[11px] text-slate-400">Confirmed dates only (company / JPX)</div>
        </div>
      </div>
    </section>
  );
}
