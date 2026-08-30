import Link from "next/link";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { ARTICLE_TITLES, hitRate, SERIES } from "@/lib/physical-ai-scoreboard";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import { SECTORS, rosterBySlug } from "@/lib/catalyst-sectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catalysts INDEX. A short entry page: the Physical-AI scored series as one
 * card, then the IR-Fair 2026 exhibitors bundled into meta-theme sectors, each
 * linking to its own page. No infinite scroll — the long condition lists live
 * on the per-sector pages.
 */

export default async function CatalystsIndexPage() {
  const [all, irFile] = await Promise.all([
    readExternalCatalysts().catch(() => []),
    getIrFairFile().catch(() => null),
  ]);

  const pa = all.filter((c) => c.series === SERIES);
  const paByArticle = new Map<number, typeof pa>();
  for (const c of pa) {
    const a = c.series_article ?? 0;
    if (!paByArticle.has(a)) paByArticle.set(a, []);
    paByArticle.get(a)!.push(c);
  }
  const paArticles = [...paByArticle.keys()].filter((a) => a > 0).sort((a, b) => a - b);
  const roster = rosterBySlug(
    irFile ?? { source: "", note: "", updated_at: "", sectors: [], catalysts: [] },
  );
  const totalExhibitors = irFile?.catalysts.length ?? 0;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl text-white sm:text-4xl">Catalysts</h1>
        <p className="max-w-2xl text-sm text-white/55">
          Dated, verifiable predictions scored by Claude — each resolves to{" "}
          <span className="text-emerald-300">HIT</span> /{" "}
          <span className="text-amber-300">PARTIAL</span> /{" "}
          <span className="text-rose-300">MISS</span> once its deadline passes.
          A free track record, organized by sector.
        </p>
      </header>

      {/* Physical AI — 6 article cards (one per part of the series) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
          <h2 className="text-lg font-bold text-white">Physical AI</h2>
          <span className="text-xs text-white/45">{pa.length} scored conditions</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paArticles.map((a) => {
            const rows = paByArticle.get(a)!;
            const stat = hitRate(rows);
            return (
              <Link
                key={a}
                href={`/catalysts/physical-ai-${a}`}
                className="terminal-card flex flex-col gap-2 p-4 no-underline transition hover:border-white/25 hover:no-underline"
              >
                <div className="text-[11px] text-white/45">Article {a}</div>
                <div className="font-display text-sm text-white">
                  {ARTICLE_TITLES[a] ?? "Other"}
                </div>
                <div className="mt-auto flex items-baseline justify-between text-[11px] text-white/50">
                  <span>{rows.length} conditions</span>
                  <span>
                    Hit rate{" "}
                    <span className="font-semibold text-white">
                      {stat.rate == null ? "—" : `${(stat.rate * 100).toFixed(0)}%`}
                    </span>{" "}
                    · {stat.judged}/{rows.length} →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* IR Fair 2026 — sector index */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
          <h2 className="text-lg font-bold text-white">IR Fair 2026 · sectors</h2>
          <span className="text-xs text-white/45">{totalExhibitors} exhibitors</span>
        </div>
        <p className="max-w-2xl text-xs text-white/40">
          Cross-cutting thesis: TSE&apos;s &quot;improve sub-1.0 PBR&quot; push × IR
          strengthening — exhibiting at the IR fair signals a company coming to
          lift its own valuation. Each sector below reads that through a specific
          judgement type. Rosters are shown by name; conditions are added and
          scored per company as they&apos;re verified from primary sources.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((s) => {
            const list = roster.get(s.slug) ?? [];
            const active = list.filter((c) => c.stage === "active").length;
            return (
              <Link
                key={s.slug}
                href={`/catalysts/${s.slug}`}
                className="terminal-card flex flex-col gap-2 p-4 no-underline transition hover:border-white/25 hover:no-underline"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-sm text-white">{s.title_en}</div>
                    <div className="text-[11px] text-white/45">{s.title_ja}</div>
                  </div>
                  <span className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/60">
                    {s.decision_type}
                  </span>
                </div>
                <div className="mt-auto flex items-baseline justify-between text-[11px] text-white/50">
                  <span>{list.length} companies</span>
                  {active > 0 ? (
                    <span>{active} scored →</span>
                  ) : (
                    <span className="text-white/35">conditions pending →</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-white/40">
        Informational only — not investment advice. Roster figures are from a
        provider snapshot and unverified; a company is scored only after its
        deadline + condition are confirmed from primary sources. Machine-readable
        Physical-AI results are served at{" "}
        <code className="text-white/60">/api/alpha/catalysts/physical-ai</code>.
      </p>
    </div>
  );
}
