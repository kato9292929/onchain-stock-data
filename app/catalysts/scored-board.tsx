import type { EvaluationStatus, ExternalCatalyst } from "@/lib/data";
import { ARTICLE_TITLES, hitRate, splitDescription } from "@/lib/physical-ai-scoreboard";

/**
 * Presentational scored-catalyst board (Physical-AI series). Overall scorecard
 * + per-article sections, rendered as a FLAT list of uniform condition cards
 * (same width / left edge / padding / spacing; sub-conditions are marked by a
 * left accent + label, not a narrower nested box). Scoring is done by the
 * evaluate cron — this only renders the committed verdicts.
 */

const STATUS_STYLE: Record<EvaluationStatus, { label: string; className: string }> = {
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
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${s.className}`}>
      {s.label}
    </span>
  );
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-white" : "text-white/85"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  );
}

/** Split a Japanese prose paragraph into sentence bullets (deterministic, no
 * LLM): keeps the trailing 。/．, drops empties — a wall of reasoning reads as
 * points instead of one block. */
function toBullets(text: string): string[] {
  return text
    .split(/(?<=[。．])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * One condition — a uniform, full-width, flat card. Same geometry for main and
 * sub; a sub only adds a left accent bar + "sub" label (no indent, no nested
 * box, same left edge and width as every other card).
 */
function CatalystCard({ c, isSub }: { c: ExternalCatalyst; isSub?: boolean }) {
  const { condition, fail_direction: fail } = splitDescription(c.catalyst_description);
  const typeLabel = c.catalyst_type ? TYPE_LABEL[c.catalyst_type] : null;
  const bullets = c.reasoning ? toBullets(c.reasoning) : [];
  return (
    <div
      className={`rounded-lg border border-white/10 bg-white/[0.02] p-4 ${
        isSub ? "border-l-2 border-l-zinc-600" : ""
      }`}
    >
      {/* header: code · name · type · deadline · verdict */}
      <div className="flex flex-wrap items-center gap-2">
        {isSub && (
          <span className="rounded bg-zinc-800 px-1 text-[10px] font-bold text-white/45">sub</span>
        )}
        <span className="font-display text-white">{c.ticker}</span>
        <span className="break-words text-sm text-zinc-300">{c.company_name ?? ""}</span>
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

      {/* success / fail conditions (wrap, never clip) */}
      <div className="mt-3 space-y-1">
        <p className="text-sm leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
          <span className="text-[11px] font-bold text-zinc-500">成立条件　</span>
          {condition}
        </p>
        {fail && (
          <p className="text-xs leading-relaxed text-rose-300/70 [overflow-wrap:anywhere]">
            <span className="text-[11px] font-bold text-rose-400/60">外れ方向　</span>
            {fail}
          </p>
        )}
      </div>

      {/* evidence: bulletized reasoning + source links */}
      {(bullets.length > 0 || c.evidence_urls.length > 0) && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <div className="text-[11px] font-bold text-zinc-500">根拠</div>
          {bullets.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-zinc-400">
                  <span className="shrink-0 text-zinc-600">・</span>
                  <span className="[overflow-wrap:anywhere]">{b}</span>
                </li>
              ))}
            </ul>
          )}
          {c.evidence_urls.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {c.evidence_urls.map((u) => (
                <a
                  key={u}
                  href={u}
                  className="text-[11px] text-sky-400/70 hover:text-sky-300 [overflow-wrap:anywhere]"
                  target="_blank"
                  rel="noreferrer"
                >
                  evidence ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Order a group's conditions as a flat list: each main immediately followed by
 * its sub-conditions, so the column reads as one even rhythm. */
function flatten(rows: ExternalCatalyst[]): { c: ExternalCatalyst; isSub: boolean }[] {
  const mains = rows.filter((c) => c.catalyst_role !== "sub");
  const subsByParent = new Map<string, ExternalCatalyst[]>();
  for (const c of rows) {
    if (c.catalyst_role === "sub" && c.parent_catalyst_id) {
      if (!subsByParent.has(c.parent_catalyst_id)) subsByParent.set(c.parent_catalyst_id, []);
      subsByParent.get(c.parent_catalyst_id)!.push(c);
    }
  }
  const out: { c: ExternalCatalyst; isSub: boolean }[] = [];
  for (const m of mains) {
    out.push({ c: m, isSub: false });
    for (const s of subsByParent.get(m.catalyst_id) ?? []) out.push({ c: s, isSub: true });
  }
  return out;
}

export function ScoredBoard({
  catalysts,
  showOverall = true,
}: {
  catalysts: ExternalCatalyst[];
  showOverall?: boolean;
}) {
  const series = [...catalysts].sort((a, b) => a.target_date.localeCompare(b.target_date));

  const byArticle = new Map<number, ExternalCatalyst[]>();
  for (const c of series) {
    const key = c.series_article ?? 0;
    if (!byArticle.has(key)) byArticle.set(key, []);
    byArticle.get(key)!.push(c);
  }
  const articles = [...byArticle.keys()].sort((a, b) => a - b);
  const overall = hitRate(series);

  return (
    <div className="space-y-6">
      {showOverall && (
        <div className="terminal-card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-base text-white">Overall</h3>
            <span className="text-xs text-white/45">{series.length} conditions</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Metric label="Hit rate" accent value={overall.rate == null ? "—" : `${(overall.rate * 100).toFixed(0)}%`} />
            <Metric label="HIT" value={overall.counts.hit} />
            <Metric label="PARTIAL" value={overall.counts.partial} />
            <Metric label="MISS" value={overall.counts.miss} />
            <Metric label="N/A" value={overall.counts.na} />
            <Metric label="Pending" value={overall.counts.pending} />
          </div>
        </div>
      )}

      {articles.map((articleNo) => {
        const rows = byArticle.get(articleNo)!;
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
            <div className="space-y-3">
              {flatten(rows).map(({ c, isSub }) => (
                <CatalystCard key={c.catalyst_id} c={c} isSub={isSub} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
