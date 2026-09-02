import Link from "next/link";
import { getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard, ARTICLE_TITLES } from "@/lib/physical-ai-scoreboard";
import { LandingHero } from "./components/landing-hero";
import { RailMarquee } from "./components/rail-marquee";

export const dynamic = "force-dynamic";

/**
 * Light, readable landing. Product axis: prediction track record (catalysts) +
 * this week's catalyst-derived selection. No P&L / benchmark tracking.
 */
export default async function Home() {
  const [portfolio, catalysts] = await Promise.all([
    getPortfolioHistory().catch(() => null),
    readExternalCatalysts().catch(() => []),
  ]);
  const asOf = new Date().toISOString().slice(0, 10);
  const board = buildScoreboard(catalysts, asOf);
  const o = board.overall;
  const cur = portfolio?.current ?? null;

  return (
    <div className="font-inter min-h-screen bg-[#f9fafb] text-slate-900">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <LandingHero />

        <div className="mt-10">
          <RailMarquee />
        </div>

        {/* Catalysts — the track record */}
        <section className="mt-16">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Track record
              </div>
              <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">Catalysts</h2>
            </div>
            <Link href="/catalysts" className="text-sm font-semibold text-[#0a152d] hover:underline">
              View all sectors →
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-outfit text-[#0a1b33]">Overall</span>
              <span className="text-xs text-slate-400">{o.total} conditions</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ["Hit rate", o.hit_rate == null ? "—" : `${(o.hit_rate * 100).toFixed(0)}%`, true],
                ["HIT", o.counts.hit, false],
                ["PARTIAL", o.counts.partial, false],
                ["MISS", o.counts.miss, false],
                ["N/A", o.counts.na, false],
                ["Pending", o.counts.pending, false],
              ].map(([label, value, accent]) => (
                <div key={label as string} className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center">
                  <div className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}>
                    {value as string | number}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{label as string}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Physical AI 6 + sectors, as light chips */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.articles.map((a) => (
              <Link
                key={a.article}
                href={`/catalysts/physical-ai-${a.article}`}
                className="rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
              >
                <div className="text-[11px] text-slate-400">Article {a.article}</div>
                <div className="font-outfit text-sm font-semibold text-[#0a1b33]">
                  {ARTICLE_TITLES[a.article] ?? a.title}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Hit rate{" "}
                  <span className="font-semibold text-[#0a1b33]">
                    {a.hit_rate == null ? "—" : `${(a.hit_rate * 100).toFixed(0)}%`}
                  </span>{" "}
                  · {a.judged}/{a.total}
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* This week's selection — from catalysts, NOT a P&L */}
        {cur && (
          <section className="mt-16">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Week of {cur.week_of} · catalyst-derived
                </div>
                <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">This week&apos;s selection</h2>
              </div>
              <Link href="/portfolio" className="text-sm font-semibold text-[#0a152d] hover:underline">
                See the picks →
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="mb-4 max-w-2xl text-sm text-slate-500">
                A research selection built from dated catalysts — not a fund and not a
                performance track. Each name carries a verifiable 1-month catalyst.
              </p>
              <div className="flex flex-wrap gap-2">
                {cur.holdings.map((h) => (
                  <span
                    key={h.ticker}
                    title={h.company_name}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px]"
                  >
                    <span className="font-semibold text-[#0a1b33]">{h.ticker}</span>
                    <span className="tabular-nums text-slate-400">{h.weight}%</span>
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-slate-200 py-8 text-xs text-slate-400">
          <p>
            Informational only — not investment advice. Predictions are scored
            against public disclosure; no market-price / market-cap data is used.
          </p>
          <p className="mt-2">
            <a href="https://github.com/kato9292929/onchain-stock-data" className="text-slate-500 hover:text-slate-700">
              github.com/kato9292929/onchain-stock-data
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
