import type { ConditionRow } from "@/lib/company-record";
import {
  EARLIER_STATES,
  RESULT_LABELS,
  STATE_LABELS,
  type EarlierRow,
  type EarlierState,
  type NeocloudCard,
} from "@/lib/neocloud-page";
import { formatMetric } from "./neocloud-metrics-table";

type Lang = "en" | "ja";
const t = (lang: Lang, en: string, ja: string) => (lang === "ja" ? ja : en);
const md = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "?");
/** "7/31 版" / "7/31 edition" */
const edition = (lang: Lang, iso: string | null) => t(lang, `${md(iso)} edition`, `${md(iso)} 版`);

const STATE_STYLE: Record<EarlierState, string> = {
  judged: "bg-slate-900 text-white",
  before: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  awaiting: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  replaced: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};
const RESULT_STYLE: Record<string, string> = {
  hit: "text-emerald-700",
  partial: "text-amber-700",
  miss: "text-rose-700",
  na: "text-slate-500",
  excluded: "text-slate-500",
};

function Badge({ state, lang }: { state: EarlierState; lang: Lang }) {
  return (
    <span data-state={state} className={`inline-flex shrink-0 items-center self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLE[state]}`}>
      {STATE_LABELS[state][lang]}
    </span>
  );
}

/** The page top: the article lineage as a chain, and the earlier conditions by state. */
export function NeocloudLineageSummary({
  chain,
  total,
  counts,
  byEdition,
  lang,
}: {
  chain: Array<{ date: string; articles: Array<{ url: string; title: string; latest: boolean }> }>;
  total: number;
  counts: Record<EarlierState, number>;
  byEdition: Array<{ edition: string; total: number; counts: Record<EarlierState, number> }>;
  lang: Lang;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-[13px] font-semibold text-[#0a1b33]">{t(lang, "Article editions", "記事の版")}</h2>
        <ol className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-2 text-[12px]">
          {chain.map((step, i) => (
            <li key={step.date} className="flex min-w-0 items-start gap-2">
              {i > 0 && <span className="pt-0.5 text-slate-300">→</span>}
              <span className="min-w-0">
                <span className="font-semibold tabular-nums text-slate-700">{md(step.date)}</span>
                {step.articles.map((a) => (
                  <a
                    key={a.url}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`block max-w-[16rem] truncate hover:underline ${a.latest ? "font-semibold text-sky-700" : "text-slate-500"}`}
                    title={a.title}
                  >
                    {a.title}
                    {a.latest && <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-semibold text-sky-700">{t(lang, "latest", "最新")}</span>}
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h2 className="text-[13px] font-semibold text-[#0a1b33]">
          {t(lang, `Conditions of the earlier editions: ${total}`, `10/20 版より前の条件 ${total}件`)}
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EARLIER_STATES.map((s) => (
            <div key={s} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-[11px] text-slate-500">{STATE_LABELS[s][lang]}</div>
              <div className="font-outfit text-2xl font-semibold tabular-nums text-[#0a1b33]">{counts[s]}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {byEdition
            .map(
              (e) =>
                `${edition(lang, e.edition)} ${t(lang, String(e.total), `${e.total}件`)}（${EARLIER_STATES.filter((s) => e.counts[s] > 0)
                  .map((s) => `${STATE_LABELS[s][lang]} ${e.counts[s]}`)
                  .join(t(lang, ", ", "・"))}）`,
            )
            .join(" / ")}
        </p>
      </div>
    </section>
  );
}

function CurrentCondition({ r, lang }: { r: ConditionRow; lang: Lang }) {
  return (
    <li className="space-y-1">
      <p className="text-[13px] leading-relaxed text-slate-800">{r.question}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-slate-500">
        <span>
          {t(lang, "Deadline", "期日")} <span className="font-semibold text-slate-700">{r.target_date}</span>
        </span>
        {(r.success_conditions ?? []).map((sc, i) => (
          <span key={i} className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-600">
            {sc.metric} {sc.operator} {sc.threshold.value.toLocaleString("en-US")} {sc.threshold.unit}
          </span>
        ))}
        <Badge state="before" lang={lang} />
      </div>
    </li>
  );
}

function Earlier({ e, lang }: { e: EarlierRow; lang: Lang }) {
  return (
    <li className="space-y-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-col-reverse gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
        <p className="min-w-0 text-[13px] leading-relaxed text-slate-700">
          <a href={e.edition_url} target="_blank" rel="noreferrer" className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500 hover:underline">
            {edition(lang, e.edition)}
          </a>
          {e.question}
        </p>
        <Badge state={e.state} lang={lang} />
      </div>
      <div className="text-[11px] tabular-nums text-slate-500">
        {e.state === "judged" && e.result ? (
          <>
            <span className={`font-semibold ${RESULT_STYLE[e.result] ?? ""}`}>{RESULT_LABELS[e.result]?.[lang] ?? e.result}</span>
            {" · "}
            {t(lang, "deadline", "期日")} {e.target_date}
            {e.evidence_url && (
              <>
                {" · "}
                <a href={e.evidence_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                  {t(lang, "evidence", "根拠")}
                </a>
              </>
            )}
          </>
        ) : e.state === "before" ? (
          <>
            {t(lang, "Judged after the deadline", "判定予定：期日")} <span className="font-semibold text-slate-700">{e.target_date}</span>
          </>
        ) : e.state === "awaiting" ? (
          <>{t(lang, `Deadline ${e.target_date} passed; verdict pending`, `期日 ${e.target_date} を過ぎ、判定待ち`)}</>
        ) : (
          <>
            {t(lang, "deadline", "期日")} {e.target_date}
          </>
        )}
      </div>
      {e.state === "judged" && e.reasoning && <p className="text-[11px] leading-relaxed text-slate-500">{e.reasoning}</p>}
      {e.next && (
        <p className="text-[11px] leading-relaxed text-slate-500">
          {e.next.by === "rewrite" ? t(lang, "Replaced by: ", "差し替え先：") : t(lang, "Carried into: ", "次の版：")}
          {e.next.question}
          <span className="tabular-nums text-slate-400">
            {" "}
            （{t(lang, "deadline", "期日")} {e.next.target_date}）
          </span>
        </p>
      )}
      {e.replaced_reason && (
        <p className="text-[11px] text-slate-500">
          {t(lang, "Replaced: ", "差し替え：")}
          {e.replaced_reason}
        </p>
      )}
      {e.article_note && (
        <p className="text-[11px] leading-relaxed text-slate-600">
          <span className="rounded bg-violet-50 px-1 font-semibold text-violet-700">
            {e.article_note.edition
              ? t(lang, `In the ${md(e.article_note.edition)} article`, `記事上の評価（${md(e.article_note.edition)} 版）`)
              : t(lang, "In the article", "記事上の評価")}
          </span>{" "}
          {e.article_note.text}{" "}
          <span className="text-slate-400">{t(lang, "— the article's own assessment, not a verdict", "（判定ではありません）")}</span>
        </p>
      )}
    </li>
  );
}

const EARNINGS_KIND: Record<NeocloudCard["next_earnings"]["kind"], { ja: string; en: string }> = {
  confirmed: { ja: "確定", en: "confirmed" },
  estimated: { ja: "推定", en: "estimated" },
  not_announced: { ja: "未発表", en: "not announced" },
  unknown: { ja: "未確認", en: "not confirmed" },
};

/** One company: group, next earnings, power, the current condition, and what became of the earlier ones. */
export function NeocloudCompanyCard({ c, lang }: { c: NeocloudCard; lang: Lang }) {
  const ne = c.next_earnings;
  const cp = c.power.contracted_power_mw;
  const en = c.power.energized_mw;
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-outfit text-lg font-semibold text-[#0a1b33]">{c.company}</span>
          <span className="font-mono text-[12px] text-slate-500">{c.ticker}</span>
          {!c.listed && <span className="text-[11px] text-slate-400">{t(lang, "unlisted", "未上場")}</span>}
          {!c.member && <span className="text-[11px] text-slate-400">· {t(lang, "not in the latest edition", "最新版では対象外")}</span>}
        </div>
        {c.group && <div className="text-[11px] font-semibold text-slate-500">{c.group}</div>}
        {c.member && c.listed && (
          <div className="text-[12px] tabular-nums text-slate-600">
            {t(lang, "Next earnings", "次の決算")} {ne.date ? <span className="font-semibold text-slate-800">{ne.date}</span> : null}{" "}
            <span className={ne.kind === "confirmed" ? "text-emerald-700" : "text-slate-400"}>（{EARNINGS_KIND[ne.kind][lang]}）</span>
          </div>
        )}
        {(cp || en) && (
          <div className="text-[12px] tabular-nums text-slate-600">
            {cp?.value != null && (
              <>
                {t(lang, "Contracted", "契約電力")} <span className="font-semibold text-slate-800">{formatMetric(cp.value, cp.unit)}</span>
              </>
            )}
            {cp?.value != null && en?.value != null && " · "}
            {en?.value != null && (
              <>
                {t(lang, "Energized", "稼働")} <span className="font-semibold text-slate-800">{formatMetric(en.value, en.unit)}</span>
              </>
            )}
            <span className="text-slate-400"> （{(cp ?? en)?.as_of}）</span>
          </div>
        )}
      </header>

      {c.member && (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-[#0a1b33]">{t(lang, "Current condition", "今の条件")}</h3>
          {c.current.length ? (
            <ul className="space-y-2">
              {c.current.map((r) => (
                <CurrentCondition key={r.id} r={r} lang={lang} />
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-slate-400">{t(lang, "No condition before its deadline", "期日前の条件なし")}</p>
          )}
        </section>
      )}

      {c.earlier.length > 0 && (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-[#0a1b33]">
            {t(lang, "Earlier editions (7/31, 7/21)", "10/20 版より前の条件（7/31・7/21 版）")}
          </h3>
          <ul className="space-y-2">
            {c.earlier.map((e) => (
              <Earlier key={e.id} e={e} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
