import Link from "next/link";
import { notFound } from "next/navigation";
import { conditionsFor } from "@/lib/company-record";
import { getSolanaStocks } from "@/lib/solana-stocks";
import { loadRecords } from "@/lib/solana-stocks-load";
import { findTheme, getThemes, themeFreeBody, themeFullBody } from "@/lib/themes";
import { PUBLIC_BASE_URL, THEME_CALL_PRICE } from "@/lib/x402";
import { SolanaMark } from "../../components/solana-mark";
import { NeocloudMetricsTable, formatMetric } from "../../components/neocloud-metrics-table";
import { isNeocloudTheme, metricSeries, neocloudCompanies } from "@/lib/neocloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One theme: every member with its next earnings date (primary source only),
 * its current dated catalyst, and whether it has a token on Solana. The whole
 * theme as JSON — conditions, verdicts, mints — is the per-call resource.
 */
export default async function ThemePage({ params }: { params: Promise<{ theme: string }> }) {
  const { theme: raw } = await params;
  const [themes, rec, solana] = await Promise.all([getThemes(), loadRecords(), getSolanaStocks().catch(() => null)]);
  const theme = findTheme(themes, decodeURIComponent(raw));
  if (!theme) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const free = themeFreeBody(theme, rec, solana, today, PUBLIC_BASE_URL);
  // The page shows each member's current catalyst; the JSON with every row is the paid view.
  const current = new Map(themeFullBody(theme, rec, solana, today).members.map((m) => [m.ticker, m.current_catalyst]));
  const fullUrl = free.full.url;
  const neocloud = isNeocloudTheme(theme)
    ? neocloudCompanies(themes)
        .filter((c) => c.theme === theme.id)
        .map((c) => ({ ticker: c.ticker, company: c.company, listed: c.listed, series: metricSeries(rec.neocloud, c.ticker) }))
    : null;
  const totals = "power_totals" in free ? free.power_totals : null;

  return (
    <div className="font-inter space-y-8">
      <Link href="/themes" className="text-xs text-slate-400 hover:text-slate-600">
        ← All themes
      </Link>
      <header className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{theme.title_en}</div>
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">{theme.title_ja}</h1>
        <ol className="space-y-0.5 text-[12px]">
          {free.lineage.map((a) => (
            <li key={a.url}>
              <span className="tabular-nums text-slate-400">{a.published_at}</span>{" "}
              <a href={a.url} target="_blank" rel="noreferrer" className={a.latest ? "font-semibold text-sky-700 hover:underline" : "text-slate-500 hover:underline"}>
                {a.title}
              </a>
              {a.latest && <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-semibold text-sky-700">latest</span>}
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-slate-400">
          {`${free.member_count} companies · ${free.active_catalysts} active catalysts. `}
          Members follow the latest edition; earlier editions&apos; conditions stay on record with their status.
        </p>
        {totals && (
          <p className="text-[13px] text-slate-600">
            Contracted power{" "}
            <span className="font-semibold tabular-nums text-[#0a1b33]">
              {totals.contracted_companies > 0 ? formatMetric(totals.contracted_power_mw, "MW") : "—"}
            </span>{" "}
            <span className="text-[11px] text-slate-400">
              ({totals.contracted_companies} of {totals.companies} disclose)
            </span>{" "}
            · Energized{" "}
            <span className="font-semibold tabular-nums text-[#0a1b33]">
              {totals.energized_companies > 0 ? formatMetric(totals.energized_mw, "MW") : "—"}
            </span>{" "}
            <span className="text-[11px] text-slate-400">
              ({totals.energized_companies} of {totals.companies} disclose)
            </span>
          </p>
        )}
      </header>

      {/* Phones: one card per company */}
      <section className="space-y-3 sm:hidden">
        {free.members.map((m) => {
          const c = current.get(m.ticker);
          return (
            <div key={m.ticker} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-[#0a1b33]">
                  {m.ticker} <span className="text-[12px] font-normal text-slate-500">{m.company}</span>
                  {m.group && <span className="ml-1 text-[11px] font-normal text-slate-400">· {m.group}</span>}
                </span>
                {m.solana_token && (
                  <Link href={`/solana-stocks/${encodeURIComponent(m.ticker)}`} className="text-[12px] font-semibold text-sky-700">
                    token
                  </Link>
                )}
              </div>
              <div className="mt-1 text-[12px] tabular-nums text-slate-500">
                Next earnings:{" "}
                {m.next_earnings.status === "confirmed" && m.next_earnings.date
                  ? m.next_earnings.date
                  : m.next_earnings.status === "not_announced"
                    ? "not announced"
                    : "—"}
              </div>
              {c && (
                <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
                  <span className="text-[11px] tabular-nums text-slate-400">target {c.target_date} · </span>
                  {c.question}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm sm:block">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Next earnings</th>
              <th className="px-4 py-3">Current catalyst</th>
              <th className="px-4 py-3">Solana</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {free.members.map((m) => {
              const c = current.get(m.ticker);
              const n = conditionsFor(m.ticker, rec).length;
              return (
                <tr key={m.ticker} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#0a1b33]">{m.ticker}</div>
                    <div className="max-w-[14rem] text-[12px] text-slate-500">
                      {m.company}
                      {!m.listed && <span className="ml-1 text-slate-400">(unlisted)</span>}
                    </div>
                    {m.group && <div className="text-[11px] text-slate-400">{m.group}</div>}
                    <div className="text-[11px] text-slate-400">
                      {n} condition{n === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {m.next_earnings.status === "confirmed" && m.next_earnings.date ? (
                      <span className="text-slate-800">{m.next_earnings.date}</span>
                    ) : (
                      <span className="text-slate-300">
                        {m.next_earnings.status === "not_announced" ? "not announced" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c ? (
                      <>
                        <div className="text-[11px] tabular-nums text-slate-400">target {c.target_date}</div>
                        <div className="max-w-[28rem] leading-relaxed text-slate-700">{c.question}</div>
                      </>
                    ) : (
                      <span className="text-slate-300">no active catalyst</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.solana_token ? (
                      <Link
                        href={`/solana-stocks/${encodeURIComponent(m.ticker)}`}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 hover:underline"
                      >
                        <SolanaMark className="h-3 w-auto" title={null} /> token
                      </Link>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {neocloud && <NeocloudMetricsTable companies={neocloud} />}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-[#0a152d] text-white shadow-sm">
        <div className="h-1 w-full bg-gradient-to-r from-[#00FFA3] to-[#DC1FFF]" />
        <div className="space-y-3 p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-outfit text-xl font-semibold">Whole theme, per call</h2>
            <span className="font-outfit text-xl font-semibold tabular-nums">{THEME_CALL_PRICE.usdc} USDC</span>
          </div>
          <p className="text-[13px] text-slate-300">
            Every member&apos;s catalysts with structured conditions and the source document, the latest verdict with its
            evidence URL, and the Solana mints — as JSON, x402 exact on Solana. Fields:{" "}
            <Link href="/docs" className="text-sky-300 hover:underline">
              /docs
            </Link>
          </p>
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-white/5 p-3 text-[12px] text-slate-200">
            <code>{`curl -i "${fullUrl}"   # 402 → pay → 200
curl "${PUBLIC_BASE_URL}/api/themes/${theme.id}"   # free member list`}</code>
          </pre>
        </div>
      </section>
    </div>
  );
}
