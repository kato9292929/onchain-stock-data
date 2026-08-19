import Link from "next/link";
import { getPerformanceHistory, getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard } from "@/lib/physical-ai-scoreboard";
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  hit: { label: "HIT", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  partial: { label: "PARTIAL", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  miss: { label: "MISS", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  na: { label: "N/A", className: "bg-white/10 text-white/50 border-white/20" },
  pending: { label: "PENDING", className: "bg-white/5 text-white/45 border-white/15" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return (
    <span className={`inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${s.className}`}>
      {s.label}
    </span>
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

  // One representative company per article (prefer a main condition), so the top
  // page lists all six Physical-AI article groups with a single name each.
  const pickByArticle = new Map<number, (typeof board.catalysts)[number]>();
  for (const c of board.catalysts) {
    if (c.series_article == null || c.catalyst_role === "sub") continue;
    if (!pickByArticle.has(c.series_article)) pickByArticle.set(c.series_article, c);
  }

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

        {/* One company per article — all six Physical-AI groups, 3 across. */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {board.articles.map((a) => {
            const c = pickByArticle.get(a.article);
            return (
              <div key={a.article} className="terminal-card flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm text-white">
                    {c ? c.ticker : "—"}
                  </span>
                  {c && <StatusBadge status={c.status} />}
                </div>
                <div className="text-[11px] text-white/45">
                  Article {a.article} · {a.title}
                </div>
                {c && (
                  <p className="line-clamp-3 text-sm leading-relaxed text-white/70">
                    {c.company_name ? (
                      <span className="text-white/85">{c.company_name} — </span>
                    ) : null}
                    {c.condition}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <Link href="/catalysts" className="landing-link">
          View scoreboard →
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
