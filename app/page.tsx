import Link from "next/link";
import { getPerformanceHistory, getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard } from "@/lib/physical-ai-scoreboard";
import { SECTORS } from "@/lib/catalyst-sectors";
import { SiteNav } from "./components/site-nav";
import { SiteFooter } from "./components/site-footer";
import { PortfolioPnl } from "./components/portfolio-pnl";
import { AllocationBreakdown } from "./components/allocation-breakdown";

export const dynamic = "force-dynamic";

/**
 * Landing / top page. Hero + real embedded previews of the two live sections
 * (Catalysts scoreboard, Portfolio P&L) built from the SAME components/data the
 * detail pages use, each linking through to the full page.
 */

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-white" : "text-white/85"}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  );
}

export default async function Home() {
  const [perf, portfolio, catalysts] = await Promise.all([
    getPerformanceHistory().catch(() => null),
    getPortfolioHistory().catch(() => null),
    readExternalCatalysts().catch(() => []),
  ]);

  const asOf = new Date().toISOString().slice(0, 10);
  const board = buildScoreboard(catalysts, asOf);
  const o = board.overall;

  return (
    <>
      <SiteNav />

      {/* Hero */}
      <section className="landing-hero">
        <h1 className="landing-title">Onchain Stock Data</h1>
        <p className="landing-tagline">Claude-Run Equity Research</p>
      </section>

      {/* 01 · Catalysts — real overall scoreboard */}
      <section className="landing-section">
        <div className="mb-4">
          <span className="landing-kicker">01 · Scoreboard</span>
          <h2 className="landing-h2">Catalysts</h2>
        </div>
        <div className="terminal-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-display text-white">Overall</span>
            <span className="text-xs text-white/45">{o.total} conditions</span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <MiniStat label="Hit rate" accent value={o.hit_rate == null ? "—" : `${(o.hit_rate * 100).toFixed(0)}%`} />
            <MiniStat label="HIT" value={o.counts.hit} />
            <MiniStat label="PARTIAL" value={o.counts.partial} />
            <MiniStat label="MISS" value={o.counts.miss} />
            <MiniStat label="N/A" value={o.counts.na} />
            <MiniStat label="Pending" value={o.counts.pending} />
          </div>
        </div>

        {/* Physical AI — 6 article cards */}
        <div className="mt-6 mb-2 text-sm font-bold text-white/70">Physical AI</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {board.articles.map((a) => (
            <Link
              key={a.article}
              href={`/catalysts/physical-ai-${a.article}`}
              className="terminal-card flex flex-col gap-2 p-5 no-underline transition hover:border-white/25 hover:no-underline!"
            >
              <span className="text-[11px] text-white/45">Article {a.article}</span>
              <span className="font-display text-base text-white">{a.title}</span>
              <span className="mt-auto text-[11px] text-white/55">
                Hit rate{" "}
                <span className="font-semibold text-white">
                  {a.hit_rate == null ? "—" : `${(a.hit_rate * 100).toFixed(0)}%`}
                </span>{" "}
                · {a.judged}/{a.total} →
              </span>
            </Link>
          ))}
        </div>

        {/* IR Fair 2026 — sector cards */}
        <div className="mt-8 mb-2 text-sm font-bold text-white/70">IR Fair 2026 · sectors</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((s) => (
            <Link
              key={s.slug}
              href={`/catalysts/${s.slug}`}
              className="terminal-card flex flex-col gap-2 p-5 no-underline transition hover:border-white/25 hover:no-underline!"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-base text-white">{s.title_en}</span>
                <span className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/60">
                  {s.decision_type}
                </span>
              </div>
              <span className="text-[11px] text-white/45">{s.title_ja}</span>
            </Link>
          ))}
        </div>

        <Link href="/catalysts" className="landing-link">
          View all sectors →
        </Link>
      </section>

      {/* 02 · Portfolio — real P&L + chart */}
      <section className="landing-section">
        <div className="mb-4">
          <span className="landing-kicker">02 · Portfolio</span>
          <h2 className="landing-h2">Portfolio</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div>
            {perf && perf.records.length > 0 ? (
              <PortfolioPnl records={perf.records} baseDate={perf.base_date} />
            ) : (
              <p className="text-sm text-white/45">No performance data.</p>
            )}
          </div>
          {portfolio?.current && (
            <AllocationBreakdown holdings={portfolio.current.holdings} />
          )}
        </div>
        <Link href="/portfolio" className="landing-link">
          View portfolio →
        </Link>
      </section>

      <SiteFooter />
    </>
  );
}
