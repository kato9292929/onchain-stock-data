import { readExternalCatalysts } from "@/lib/external-catalysts";
import type { EvaluationStatus, ExternalCatalyst } from "@/lib/data";

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

const SERIES = "physical-ai";

/** Editorial article titles (1-based), matching the six-part series. */
const ARTICLE_TITLES: Record<number, string> = {
  1: "日本・上場企業（決算型 catalyst）",
  2: "日本・未上場スタートアップ（イベント型）",
  3: "米国・上場 ロボティクス",
  4: "米国・上場 半導体・センサ",
  5: "米国・未上場 ロボット本体",
  6: "米国・未上場 AI モデル・基盤",
};

const JUDGED: EvaluationStatus[] = ["hit", "partial", "miss", "na"];

const STATUS_STYLE: Record<
  EvaluationStatus,
  { label: string; className: string }
> = {
  hit: { label: "HIT", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  partial: { label: "PARTIAL", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  miss: { label: "MISS", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  na: { label: "N/A", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  pending: { label: "判定待ち", className: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

const TYPE_LABEL: Record<NonNullable<ExternalCatalyst["catalyst_type"]>, string> = {
  earnings: "決算",
  event: "イベント",
  fixed_date: "確定日",
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

/** Split the folded "condition【外れ方向】fail" description into its two halves. */
function splitDescription(desc: string): { condition: string; fail: string | null } {
  const idx = desc.indexOf("【外れ方向】");
  if (idx === -1) return { condition: desc, fail: null };
  return {
    condition: desc.slice(0, idx),
    fail: desc.slice(idx + "【外れ方向】".length),
  };
}

function CatalystRow({
  c,
  isSub,
}: {
  c: ExternalCatalyst;
  isSub?: boolean;
}) {
  const { condition, fail } = splitDescription(c.catalyst_description);
  const typeLabel = c.catalyst_type ? TYPE_LABEL[c.catalyst_type] : null;
  return (
    <div
      className={`rounded border border-zinc-800 bg-zinc-950/60 p-3 ${
        isSub ? "ml-4 border-l-2 border-l-zinc-700" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isSub && <span className="text-[10px] font-bold text-zinc-500">補助線</span>}
        <span className="font-bold text-gold-bright">{c.ticker}</span>
        <span className="text-sm text-zinc-300">{c.company_name ?? ""}</span>
        {typeLabel && (
          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {typeLabel}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {c.target_date}
            {c.date_confidence === "confirmed" ? "（確定）" : "（予想）"}
          </span>
          <StatusBadge status={c.status} />
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-zinc-200">{condition}</p>
      {fail && (
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          <span className="text-rose-400/80">外れ方向:</span> {fail}
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
              className="text-[11px] text-gold underline decoration-dotted"
            >
              根拠 ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function hitRate(list: ExternalCatalyst[]) {
  const counts = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0 };
  for (const c of list) counts[c.status] += 1;
  const judged = counts.hit + counts.partial + counts.miss + counts.na;
  // Partial counts as a half-hit; na (催告不能) is excluded from the denominator.
  const scored = counts.hit + counts.partial + counts.miss;
  const rate = scored > 0 ? (counts.hit + counts.partial * 0.5) / scored : null;
  return { counts, judged, rate };
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

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Physical AI カタログ｜予測スコアボード</h1>
        <p className="text-sm text-zinc-400">
          「フィジカル AI」特集（全 6 記事）で挙げた、日付つきで検証可能な予測を Claude が
          日次で採点します。各条件は期日到来後に{" "}
          <span className="text-emerald-300">HIT</span> /{" "}
          <span className="text-amber-300">PARTIAL</span> /{" "}
          <span className="text-rose-300">MISS</span> /{" "}
          <span className="text-zinc-400">N/A</span> のいずれかに確定。無料公開の
          トラックレコードです。
        </p>
      </header>

      {/* Overall scorecard */}
      <div className="terminal-card p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-bold text-zinc-200">全体スコア</h3>
          <span className="text-xs text-zinc-500">{series.length} 条件</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Metric label="的中率" value={overall.rate == null ? "—" : `${(overall.rate * 100).toFixed(0)}%`} accent />
          <Metric label="HIT" value={overall.counts.hit} />
          <Metric label="PARTIAL" value={overall.counts.partial} />
          <Metric label="MISS" value={overall.counts.miss} />
          <Metric label="N/A" value={overall.counts.na} />
          <Metric label="判定待ち" value={overall.counts.pending} />
        </div>
        <p className="mt-3 text-[11px] text-zinc-600">
          的中率 = (HIT + PARTIAL×0.5) ÷ (HIT + PARTIAL + MISS)。N/A・判定待ちは分母から除外。
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
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 pb-2">
              <h2 className="text-lg font-bold">
                <span className="text-zinc-500">記事 {articleNo}｜</span>
                {ARTICLE_TITLES[articleNo] ?? "その他"}
              </h2>
              <span className="text-xs text-zinc-500">
                的中率{" "}
                <span className="font-bold text-gold-bright">
                  {stat.rate == null ? "—" : `${(stat.rate * 100).toFixed(0)}%`}
                </span>{" "}
                ・{stat.judged}/{rows.length} 判定済
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

      <p className="text-xs text-zinc-600">
        本スコアボードは Claude による情報提供であり投資助言ではありません。予想日
        （予想）は暫定で、公式発表後に確定日へ差し替えます。機械可読な採点結果は
        有料エンドポイント <code className="text-zinc-400">/api/alpha/...</code> で提供。
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
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-center">
      <div
        className={`text-xl font-bold tabular-nums ${
          accent ? "text-gold-bright" : "text-zinc-200"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}
