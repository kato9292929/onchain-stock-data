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
    <Link href="/catalysts" className="text-xs text-slate-400 hover:text-slate-600">
      ← All sectors
    </Link>
  );
}

/** 百万円 (JPY millions) → 兆円 / 億円 label. */
function fmtMoney(v?: number | null): string {
  if (v == null) return "—";
  const oku = v / 100; // 百万 → 億
  return oku >= 10000
    ? `${(oku / 10000).toFixed(2)}兆円`
    : `${Math.round(oku).toLocaleString()}億円`;
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
            <div className="text-xs text-slate-400">Physical AI · Article {articleNo}</div>
          )}
          <h1 className="font-display text-3xl text-slate-900">{title}</h1>
          {articleNo == null && (
            <p className="max-w-2xl text-sm text-slate-500">
              Six-part series on US &amp; Japan physical-AI names — robotics, semis
              &amp; sensors, humanoid builders, and AI models &amp; infra. Each
              condition is scored once its deadline passes.
            </p>
          )}
        </header>
        {articleNo === 2 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
            <span className="font-bold">未公開株の注記　</span>
            これらは売買シグナルではありません（トレード不可）。役割はフィジカルAIの
            テーマ地図と、IPOパイプラインの先行監視です。判定は開示された事実
            （提携・製品・調達＝マイルストンの有無）で行い、株価・評価額では判定しません。
          </div>
        )}
        {pa.length > 0 ? (
          <ScoredBoard catalysts={pa} showOverall={articleNo == null} />
        ) : (
          <p className="text-sm text-slate-400">No conditions.</p>
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
  const draft = roster.filter((c) => c.stage !== "active");

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="font-display text-3xl text-slate-900">{meta.title_en}</h1>
          <span className="text-slate-400">{meta.title_ja}</span>
        </div>
        <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500">
          {meta.decision_type}
        </span>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">{meta.analysis}</p>
      </header>

      {/* Researched (active) — sourced catalysts + latest financials */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between border-b border-slate-200 pb-2">
          <h2 className="text-sm font-bold text-slate-700">Researched</h2>
          <span className="text-xs text-slate-400">{active.length} companies</span>
        </div>
        {active.length === 0 ? (
          <p className="text-xs text-slate-400">
            まだ無し。名簿を一次資料で1社ずつ裏取りしてここに昇格させます（決算値＋
            判定条件＋出典）。締切到来後に HIT/MISS を採点。
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((c) => (
              <div key={c.catalyst_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-slate-900">{c.ticker}</span>
                  <span className="break-words text-sm text-slate-700">{c.company_name}</span>
                  {c.tse_market && (
                    <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {c.tse_market}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-slate-400">
                    {c.due_date && <span>締切 {c.due_date}</span>}
                    <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500">
                      PENDING
                    </span>
                  </span>
                </div>

                {c.business_line && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
                    {c.business_line}
                  </p>
                )}

                {(c.revenue != null || c.operating_income != null) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span>売上 <span className="tabular-nums text-slate-800">{fmtMoney(c.revenue)}</span></span>
                    <span>営業利益 <span className="tabular-nums text-slate-800">{fmtMoney(c.operating_income)}</span></span>
                    {c.fiscal_period && <span className="text-slate-400">{c.fiscal_period}</span>}
                    {c.disclosed_at && <span className="text-slate-400">発表 {c.disclosed_at}</span>}
                  </div>
                )}

                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                  {c.success_condition && (
                    <p className="text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
                      <span className="text-[11px] font-bold text-slate-400">成立条件　</span>
                      {c.success_condition}
                    </p>
                  )}
                  {c.fail_condition && (
                    <p className="text-xs leading-relaxed text-rose-600 [overflow-wrap:anywhere]">
                      <span className="text-[11px] font-bold text-rose-500">外れ方向　</span>
                      {c.fail_condition}
                    </p>
                  )}
                </div>

                {c.source && (
                  <a
                    href={c.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[11px] text-sky-600 hover:text-sky-700 [overflow-wrap:anywhere]"
                  >
                    出典 ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Roster (IR Fair 2026 exhibitors, not yet researched) */}
      <section className="space-y-2">
        <div className="border-b border-slate-200 pb-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-slate-700">Roster · IR Fair 2026</h2>
            <span className="text-xs text-slate-400">{draft.length} companies</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            一次資料で裏取り後、決算値＋判定条件を付けて Researched に昇格します。以下は
            その前段の名簿（社名・コード。市場区分は取得時点のスナップショットで未検証）。
          </p>
        </div>
        <div className="divide-y divide-slate-100 overflow-hidden rounded border border-slate-200">
          {draft.map((c) => (
            <div
              key={c.catalyst_id}
              className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-x-3 bg-white px-3 py-2"
            >
              <span className="font-display text-sm tabular-nums text-slate-800">{c.ticker}</span>
              <span className="truncate text-sm text-slate-700">{c.company_name}</span>
              <span className="flex items-center gap-2 justify-self-end">
                {c.tse_market && (
                  <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {c.tse_market}
                  </span>
                )}
                <span className="hidden text-[11px] text-slate-400 sm:inline">{c.sector}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
