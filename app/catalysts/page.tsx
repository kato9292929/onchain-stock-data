import { readExternalCatalysts } from "@/lib/external-catalysts";
import type { EvaluationStatus, ExternalCatalyst } from "@/lib/data";
import {
  ARTICLE_TITLES,
  JUDGED,
  SERIES,
  hitRate,
  splitDescription,
} from "@/lib/physical-ai-scoreboard";
import {
  buildIrFairBoard,
  getIrFairFile,
  type IrFairSectorBoard,
} from "@/lib/ir-fair-scoreboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free public scoreboard for the editorial "Physical AI" series dated catalysts.
 * Shows the track record — per-article hit-rate and every scorable condition —
 * so a reader can ask "did this article's predictions come true?" without any
 * paywall. Presentation only; judging happens in the daily evaluate-catalysts
 * job, which flips each entry from pending → hit/partial/miss/na.
 *
 * The paid machine-readable surface lives at /api/alpha/... — this page is the
 * human-facing counterpart and stays free on purpose.
 */

const STATUS_STYLE: Record<
  EvaluationStatus,
  { label: string; className: string }
> = {
  hit: { label: "HIT", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  partial: { label: "PARTIAL", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  miss: { label: "MISS", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  na: { label: "N/A", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  pending: { label: "PENDING", className: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

const TYPE_LABEL: Record<NonNullable<ExternalCatalyst["catalyst_type"]>, string> = {
  earnings: "Earnings",
  event: "Event",
  fixed_date: "Fixed date",
};

function StatusBadge({ status }: { status: EvaluationStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${s.className}`}
    >
      {s.label}
    </span>
  );
}

function CatalystRow({
  c,
  isSub,
}: {
  c: ExternalCatalyst;
  isSub?: boolean;
}) {
  const { condition, fail_direction: fail } = splitDescription(c.catalyst_description);
  const typeLabel = c.catalyst_type ? TYPE_LABEL[c.catalyst_type] : null;
  return (
    <div
      className={`rounded border border-zinc-800 bg-zinc-950/60 p-3 ${
        isSub ? "ml-4 border-l-2 border-l-zinc-700" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isSub && <span className="text-[10px] font-bold text-white/45">sub</span>}
        <span className="font-display text-white">{c.ticker}</span>
        <span className="text-sm text-zinc-300">{c.company_name ?? ""}</span>
        {typeLabel && (
          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {typeLabel}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {c.target_date}
            {c.date_confidence === "confirmed" ? " (confirmed)" : " (est.)"}
          </span>
          <StatusBadge status={c.status} />
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-zinc-200">{condition}</p>
      {fail && (
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          <span className="text-rose-400/80">Fail:</span> {fail}
        </p>
      )}

      {JUDGED.includes(c.status) && c.reasoning && (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-xs leading-relaxed text-zinc-400">
          {c.reasoning}
        </p>
      )}
      {c.evidence_urls.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {c.evidence_urls.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-white/60 underline decoration-dotted"
            >
              Evidence ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SectorCard({ sector }: { sector: IrFairSectorBoard }) {
  return (
    <div className="terminal-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-sm text-white">{sector.title_en}</div>
          <div className="text-[11px] text-white/45">{sector.title_ja}</div>
        </div>
        <span className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/60">
          {sector.total}
        </span>
      </div>
      <div className="flex items-baseline justify-between text-[11px] text-white/50">
        <span>{sector.total} companies</span>
        {sector.active > 0 ? (
          <span>
            Hit rate{" "}
            <span className="font-semibold text-white">
              {sector.hit_rate == null ? "—" : `${(sector.hit_rate * 100).toFixed(0)}%`}
            </span>{" "}
            · {sector.active} active
          </span>
        ) : (
          <span className="text-white/35">conditions pending</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {sector.companies.map((c) => (
          <span
            key={c.catalyst_id}
            title={c.company_name}
            className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-white/60"
          >
            {c.ticker}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function CatalystsScoreboardPage() {
  const all = await readExternalCatalysts();
  const series = all
    .filter((c) => c.series === SERIES)
    .sort((a, b) => a.target_date.localeCompare(b.target_date));

  const overall = hitRate(series);

  // Group by article, main conditions first, each carrying its sub-conditions.
  const byArticle = new Map<number, ExternalCatalyst[]>();
  for (const c of series) {
    const key = c.series_article ?? 0;
    if (!byArticle.has(key)) byArticle.set(key, []);
    byArticle.get(key)!.push(c);
  }
  const articles = [...byArticle.keys()].sort((a, b) => a - b);

  const asOf = new Date().toISOString().slice(0, 10);
  const irFair = buildIrFairBoard(await getIrFairFile(), asOf);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl sm:text-4xl text-white">
          Physical AI Scoreboard
        </h1>
        <p className="text-sm text-white/55 max-w-2xl">
          Dated, verifiable predictions from the Physical-AI series (6 articles),
          scored daily by Claude. Each condition resolves to{" "}
          <span className="text-emerald-300">HIT</span> /{" "}
          <span className="text-amber-300">PARTIAL</span> /{" "}
          <span className="text-rose-300">MISS</span> /{" "}
          <span className="text-white/60">N/A</span> once its deadline passes. A
          free, public track record.
        </p>
      </header>

      {/* Overall scorecard */}
      <div className="terminal-card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-display text-base text-white">Overall</h3>
          <span className="text-xs text-white/45">{series.length} conditions</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Metric label="Hit rate" value={overall.rate == null ? "—" : `${(overall.rate * 100).toFixed(0)}%`} accent />
          <Metric label="HIT" value={overall.counts.hit} />
          <Metric label="PARTIAL" value={overall.counts.partial} />
          <Metric label="MISS" value={overall.counts.miss} />
          <Metric label="N/A" value={overall.counts.na} />
          <Metric label="Pending" value={overall.counts.pending} />
        </div>
        <p className="mt-3 text-[11px] text-white/40">
          Hit rate = (HIT + PARTIAL×0.5) ÷ (HIT + PARTIAL + MISS). N/A and pending are excluded from the denominator.
        </p>
      </div>

      {/* Per-article sections */}
      {articles.map((articleNo) => {
        const rows = byArticle.get(articleNo)!;
        const mains = rows.filter((c) => c.catalyst_role !== "sub");
        const subsByParent = new Map<string, ExternalCatalyst[]>();
        for (const c of rows) {
          if (c.catalyst_role === "sub" && c.parent_catalyst_id) {
            if (!subsByParent.has(c.parent_catalyst_id))
              subsByParent.set(c.parent_catalyst_id, []);
            subsByParent.get(c.parent_catalyst_id)!.push(c);
          }
        }
        const stat = hitRate(rows);
        return (
          <section key={articleNo} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
              <h2 className="text-lg font-bold text-white">
                <span className="text-white/45">Article {articleNo} · </span>
                {ARTICLE_TITLES[articleNo] ?? "Other"}
              </h2>
              <span className="text-xs text-white/45">
                Hit rate{" "}
                <span className="font-semibold text-white">
                  {stat.rate == null ? "—" : `${(stat.rate * 100).toFixed(0)}%`}
                </span>{" "}
                · {stat.judged}/{rows.length} judged
              </span>
            </div>
            <div className="space-y-2">
              {mains.map((m) => (
                <div key={m.catalyst_id} className="space-y-2">
                  <CatalystRow c={m} />
                  {(subsByParent.get(m.catalyst_id) ?? []).map((s) => (
                    <CatalystRow key={s.catalyst_id} c={s} isSub />
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* IR Fair 2026 — sector-grouped roster */}
      {irFair.sectors.length > 0 && (
        <section className="space-y-4 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
            <h2 className="text-lg font-bold text-white">
              <span className="text-white/45">IR Fair 2026 · </span>by sector
            </h2>
            <span className="text-xs text-white/45">
              {irFair.overall.total} exhibitors · {irFair.overall.sectors} sectors ·{" "}
              {irFair.overall.active} active · {irFair.overall.draft} draft
            </span>
          </div>
          <p className="max-w-2xl text-xs text-white/40">
            Nikkei × TSE IR Fair 2026 exhibitors, grouped by TSE sector. Each
            company gets a dated, binary catalyst on the same framework as above —
            shown here as a roster while its success/fail condition is verified
            from primary sources. Draft entries are not scored.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {irFair.sectors.map((s) => (
              <SectorCard key={s.id} sector={s} />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-white/40">
        Informational only — not investment advice. Estimated dates (est.) are
        provisional and replaced with confirmed dates after official announcements.
        Machine-readable results are served at{" "}
        <code className="text-white/60">/api/alpha/...</code>.
      </p>
    </div>
  );
}

function Metric({
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
      <div
        className={`text-xl font-semibold tabular-nums ${
          accent ? "text-white" : "text-white/85"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  );
}
