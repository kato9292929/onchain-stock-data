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

        {/* Sectors — entry points into the per-sector catalyst pages. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Link
            href="/catalysts/physical-ai"
            className="terminal-card flex flex-col gap-1 p-3 transition hover:border-white/25"
          >
            <span className="font-display text-sm text-white">Physical AI</span>
            <span className="text-[10px] text-white/45">Scored series</span>
          </Link>
          {SECTORS.map((s) => (
            <Link
              key={s.slug}
              href={`/catalysts/${s.slug}`}
              className="terminal-card flex flex-col gap-1 p-3 transition hover:border-white/25"
            >
              <span className="font-display text-sm text-white">{s.title_en}</span>
              <span className="text-[10px] text-white/45">{s.title_ja}</span>
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
