import Link from "next/link";
import type { FrontRow } from "@/lib/neocloud-page";
import { formatMetric } from "./neocloud-metrics-table";

type Lang = "en" | "ja";
const t = (lang: Lang, en: string, ja: string) => (lang === "ja" ? ja : en);

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function metricText(m: NonNullable<FrontRow["metric"]>) {
  if (m.low !== null || m.high !== null) {
    return `${m.low !== null ? formatMetric(m.low, m.unit) : "?"} – ${m.high !== null ? formatMetric(m.high, m.unit) : "?"}`;
  }
  return formatMetric(m.value, m.unit);
}

function Earnings({ r, lang }: { r: FrontRow; lang: Lang }) {
  const ne = r.next_earnings;
  if (!ne.date) return null;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-slate-800">{ne.date}</span>{" "}
      <span className={ne.kind === "confirmed" ? "text-emerald-700" : "text-slate-400"}>
        {ne.kind === "confirmed" ? t(lang, "confirmed", "確定") : t(lang, "estimated", "推定")}
      </span>
    </span>
  );
}

/**
 * The front page's neocloud block: up to six companies, the next to report
 * first — each with its current condition and one disclosed number with its
 * document. A company with no recorded number simply has no number shown.
 * One language at a time (lib/i18n).
 */
export function NeocloudSummary({
  rows,
  usCount,
  jpCount,
  pricePerCall,
  lang,
}: {
  rows: FrontRow[];
  usCount: number;
  jpCount: number;
  pricePerCall: number;
  lang: Lang;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 min-w-0">
        <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">
          {t(lang, `Neocloud — ${usCount} US · ${jpCount} Japan`, `ネオクラウド — 米国 ${usCount}社・日本 ${jpCount}社`)}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t(
            lang,
            `Per-company power, backlog, guidance and financing from filings — ${pricePerCall} USDC per call.`,
            `会社ごとの電力・受注残・ガイダンス・資金調達を、開示書類から。1 回 ${pricePerCall} USDC。`,
          )}
        </p>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {rows.map((r) => (
          <li key={r.ticker} data-row={r.ticker} className="px-4 py-3 text-[13px]">
            {/* line 1: company, and its next earnings on the right when known */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <span className="font-semibold text-[#0a1b33]">{r.company}</span>{" "}
                <span className="font-mono text-[11px] text-slate-500">{r.ticker}</span>
                <span className="ml-1 text-[10px] text-slate-400">{r.market === "JP" ? t(lang, "JP", "日本") : t(lang, "US", "米国")}</span>
              </div>
              {r.next_earnings.date && (
                <div className="text-[12px]">
                  <span className="text-slate-400">{t(lang, "Earnings", "決算")}</span> <Earnings r={r} lang={lang} />
                </div>
              )}
            </div>
            {/* line 2: the condition, then the disclosed number when there is one */}
            {(r.condition || r.metric) && (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] leading-relaxed text-slate-600">
                {r.condition && (
                  <span className="min-w-0">
                    {r.condition.rule ? (
                      <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-700">{r.condition.rule}</span>
                    ) : (
                      <span>{r.condition.question}</span>
                    )}
                    <span className="ml-1 whitespace-nowrap tabular-nums text-slate-400">
                      {t(lang, "by", "期日")} {r.condition.target_date}
                    </span>
                  </span>
                )}
                {r.metric && (
                  <a
                    href={r.metric.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    title={`${t(lang, r.metric.label, r.metric.label_ja)} (${r.metric.as_of})`}
                  >
                    <span className="text-slate-500">{t(lang, r.metric.label, r.metric.label_ja)}</span>{" "}
                    <span className="font-semibold tabular-nums text-[#0a1b33]">{metricText(r.metric)}</span>{" "}
                    <span className="text-sky-700">{host(r.metric.source_url)}</span>
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link href="/themes/neocloud-us" className="text-sky-700 hover:underline">
          {t(lang, `All ${usCount} US →`, `米国 ${usCount}社の一覧 →`)}
        </Link>
        <Link href="/themes/neocloud-jp" className="text-sky-700 hover:underline">
          {t(lang, `All ${jpCount} Japan →`, `日本 ${jpCount}社の一覧 →`)}
        </Link>
        <Link href="/api/neocloud/digest" className="text-sky-700 hover:underline">
          {t(lang, "Filings, last 7 days (API) →", "直近7日の開示（API）→")}
        </Link>
      </p>
    </section>
  );
}

/** The very top: what OSD is, and how much is on record. (The JP | EN switch sits above it, app/page.tsx.) */
export function SiteIntro({
  companies,
  active,
  judged,
  lang,
}: {
  companies: number;
  active: number;
  judged: number;
  lang: Lang;
}) {
  const stats: Array<[string, number]> = [
    [t(lang, "companies covered", "収録銘柄"), companies],
    [t(lang, "active conditions", "有効な条件"), active],
    [t(lang, "judged", "判定済み"), judged],
  ];
  return (
    <section className="pt-1">
      <h1 className="font-outfit text-[32px] font-semibold leading-tight tracking-tight text-[#0a1b33] md:text-[44px]">
        {t(lang, "Claude-run equity research", "Claude が運用する株式リサーチ")}
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600 md:text-[15px]">
        {t(
          lang,
          "Dated, numeric catalysts for US and Japanese stocks — each scored HIT / PARTIAL / MISS against the company's own disclosure once its deadline passes. Free to read; agents pay per call in USDC on Solana (x402).",
          "日米の株式に、期日と数値の付いた条件を置き、期日が来たら会社自身の開示で HIT / PARTIAL / MISS を判定します。読むのは無料。エージェントは 1 回ごとに Solana の USDC で支払います（x402）。",
        )}
      </p>
      <dl className="mt-4 grid max-w-xl grid-cols-3 gap-2">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <dt className="text-[11px] leading-tight text-slate-500">{label}</dt>
            <dd className="font-outfit text-xl font-semibold tabular-nums text-[#0a1b33]">{n.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
