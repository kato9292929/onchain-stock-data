import Link from "next/link";
import { notFound } from "next/navigation";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { ARTICLE_TITLES, SERIES } from "@/lib/physical-ai-scoreboard";
import { getIrFairFile } from "@/lib/ir-fair-scoreboard";
import {
  PHYSICAL_AI_SLUG,
  SECTOR_BY_SLUG,
  rosterBySlug,
} from "@/lib/catalyst-sectors";
import { ScoredBoard } from "../scored-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One catalyst sector. Either the Physical-AI scored series (slug
 * "physical-ai") or an IR-Fair meta-theme: analysis header, any scored
 * conditions, and the exhibitor roster (by name; draft = condition pending).
 */

function BackLink() {
  return (
    <Link href="/catalysts" className="text-xs text-white/45 hover:text-white/70">
      ← All sectors
    </Link>
  );
}

export default async function CatalystSectorPage({
  params,
}: {
  params: Promise<{ sector: string }>;
}) {
  const { sector: slug } = await params;

  // Physical-AI: the full series (slug "physical-ai") or one article
  // (slug "physical-ai-N").
  const paMatch = slug.match(/^physical-ai(?:-(\d+))?$/);
  if (paMatch) {
    const articleNo = paMatch[1] ? Number(paMatch[1]) : null;
    const all = await readExternalCatalysts().catch(() => []);
    let pa = all.filter((c) => c.series === SERIES);
    if (articleNo != null) pa = pa.filter((c) => c.series_article === articleNo);
    if (articleNo != null && pa.length === 0) notFound();

    const title =
      articleNo != null
        ? ARTICLE_TITLES[articleNo] ?? "Physical AI"
        : "Physical AI";
    return (
      <div className="space-y-6">
        <BackLink />
        <header className="space-y-2">
          {articleNo != null && (
            <div className="text-xs text-white/45">Physical AI · Article {articleNo}</div>
          )}
          <h1 className="font-display text-3xl text-white">{title}</h1>
          {articleNo == null && (
            <p className="max-w-2xl text-sm text-white/55">
              Six-part series on US &amp; Japan physical-AI names — robotics, semis
              &amp; sensors, humanoid builders, and AI models &amp; infra. Each
              condition is scored once its deadline passes.
            </p>
          )}
        </header>
        {pa.length > 0 ? (
          <ScoredBoard catalysts={pa} showOverall={articleNo == null} />
        ) : (
          <p className="text-sm text-white/45">No conditions.</p>
        )}
      </div>
    );
  }

  // IR-Fair meta-theme.
  const meta = SECTOR_BY_SLUG[slug];
  if (!meta) notFound();

  const irFile = await getIrFairFile().catch(() => null);
  const roster =
    rosterBySlug(
      irFile ?? { source: "", note: "", updated_at: "", sectors: [], catalysts: [] },
    ).get(slug) ?? [];
  const active = roster.filter((c) => c.stage === "active");

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="font-display text-3xl text-white">{meta.title_en}</h1>
          <span className="text-white/45">{meta.title_ja}</span>
        </div>
        <span className="inline-block rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/60">
          {meta.decision_type}
        </span>
        <p className="max-w-2xl text-sm leading-relaxed text-white/60">
          {meta.analysis}
        </p>
      </header>

      {/* Scored (active conditions) */}
      <section className="space-y-2">
        <h2 className="border-b border-white/10 pb-2 text-sm font-bold text-white/70">
          Scored
        </h2>
        {active.length === 0 ? (
          <p className="text-xs text-white/40">
            No scored conditions yet — the roster below is verified and promoted
            per company. A row is scored only after its deadline + success/fail
            condition are confirmed from primary sources.
          </p>
        ) : (
          <p className="text-xs text-white/40">{active.length} scored — see rows.</p>
        )}
      </section>

      {/* Roster (IR Fair 2026 exhibitors) */}
      <section className="space-y-2">
        <div className="border-b border-white/10 pb-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-white/70">Roster · IR Fair 2026</h2>
            <span className="text-xs text-white/45">{roster.length} companies</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            条件は一次資料で確認後、Scored に昇格して採点対象になります。以下はその
            前段の名簿（社名・コード。市場区分は取得時点のスナップショットで未検証）。
          </p>
        </div>
        <div className="divide-y divide-white/5 overflow-hidden rounded border border-white/10">
          {roster.map((c) => (
            <div
              key={c.catalyst_id}
              className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-x-3 bg-white/[0.02] px-3 py-2"
            >
              <span className="font-display text-sm tabular-nums text-white/80">
                {c.ticker}
              </span>
              <span className="truncate text-sm text-zinc-300">{c.company_name}</span>
              <span className="flex items-center gap-2 justify-self-end">
                {c.tse_market && (
                  <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {c.tse_market}
                  </span>
                )}
                <span className="hidden text-[11px] text-zinc-500 sm:inline">
                  {c.sector}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
