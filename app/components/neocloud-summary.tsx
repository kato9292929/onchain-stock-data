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
 * The front page's neocloud block, built like the Catalysts section: a section
 * header with links on the right, then compact cards (label, title, one or two
 * small lines). Up to six companies, the next to report first. A company with
 * no recorded number simply has no number line. One language at a time (lib/i18n).
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
    <section className="mt-16">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t(lang, `Neocloud · ${usCount} US · ${jpCount} Japan · ${pricePerCall} USDC per call`, `ネオクラウド · 米国 ${usCount}社 · 日本 ${jpCount}社 · 1 回 ${pricePerCall} USDC`)}
          </div>
          <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">{t(lang, "Neocloud", "ネオクラウド")}</h2>
        </div>
        <span className="flex flex-wrap gap-4">
          <Link href="/themes/neocloud-us" className="text-sm font-semibold text-[#0a152d] hover:underline">
            {t(lang, "US →", "米国 →")}
          </Link>
          <Link href="/themes/neocloud-jp" className="text-sm font-semibold text-[#0a152d] hover:underline">
            {t(lang, "Japan →", "日本 →")}
          </Link>
          <Link href="/api/neocloud/digest" className="text-sm font-semibold text-[#0a152d] hover:underline">
            {t(lang, "Filings, 7 days →", "直近7日の開示 →")}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.ticker} data-row={r.ticker} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] text-slate-400">
              {r.market === "JP" ? t(lang, "Japan", "日本") : t(lang, "US", "米国")} · {r.ticker}
              {r.next_earnings.date && (
                <>
                  {" · "}
                  {t(lang, "Earnings", "決算")} <Earnings r={r} lang={lang} />
                </>
              )}
            </div>
            <div className="truncate font-outfit text-sm font-semibold text-[#0a1b33]">{r.company}</div>
            {r.condition && (
              <div className="mt-2 truncate text-[11px] text-slate-500" title={r.condition.rule ?? r.condition.question}>
                <span className="text-slate-700">{r.condition.rule ?? r.condition.question}</span>{" "}
                <span className="tabular-nums text-slate-400">
                  {t(lang, "by", "期日")} {r.condition.target_date}
                </span>
              </div>
            )}
            {r.metric && (
              <a
                href={r.metric.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block truncate text-[11px] hover:underline"
                title={`${t(lang, r.metric.label, r.metric.label_ja)} (${r.metric.as_of})`}
              >
                <span className="text-slate-500">{t(lang, r.metric.label, r.metric.label_ja)}</span>{" "}
                <span className="font-semibold tabular-nums text-[#0a1b33]">{metricText(r.metric)}</span>{" "}
                <span className="text-sky-700">{host(r.metric.source_url)}</span>
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** How much is on record — a section shaped like Catalysts: header, then the "Overall"-style panel. */
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
  const stats: Array<[string, number, boolean]> = [
    [t(lang, "Companies covered", "収録銘柄"), companies, true],
    [t(lang, "Active conditions", "有効な条件"), active, false],
    [t(lang, "Judged", "判定済み"), judged, false],
  ];
  return (
    <section className="mt-16">
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t(lang, "Coverage", "収録")}</div>
        <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">{t(lang, "On record", "記録の件数")}</h2>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-outfit text-[#0a1b33]">{t(lang, "Overall", "全体")}</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {stats.map(([label, n, accent]) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center">
              <dd className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}>{n.toLocaleString("en-US")}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
