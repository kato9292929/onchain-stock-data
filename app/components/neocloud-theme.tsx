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

const md = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "?");

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

function Badge({ state }: { state: EarlierState }) {
  return (
    <span data-state={state} className={`inline-flex shrink-0 items-center self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLE[state]}`}>
      {STATE_LABELS[state].ja} <span className="ml-1 font-normal opacity-75">{STATE_LABELS[state].en}</span>
    </span>
  );
}

function Bi({ ja, en, className = "" }: { ja: string; en: string; className?: string }) {
  return (
    <span className={className}>
      {ja} <span className="font-normal text-slate-400">{en}</span>
    </span>
  );
}

/** The page top: the article lineage as a chain, and the earlier conditions by state. */
export function NeocloudLineageSummary({
  chain,
  total,
  counts,
  byEdition,
}: {
  chain: Array<{ date: string; articles: Array<{ url: string; title: string; latest: boolean }> }>;
  total: number;
  counts: Record<EarlierState, number>;
  byEdition: Array<{ edition: string; total: number; counts: Record<EarlierState, number> }>;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-[13px] font-semibold text-[#0a1b33]">
          <Bi ja="記事の版" en="Article editions" />
        </h2>
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
                    {a.latest && <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-semibold text-sky-700">最新 latest</span>}
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h2 className="text-[13px] font-semibold text-[#0a1b33]">
          <Bi ja={`10/20 版より前の条件 ${total}件`} en={`Earlier editions' conditions: ${total}`} />
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EARLIER_STATES.map((s) => (
            <div key={s} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-[11px] text-slate-500">
                {STATE_LABELS[s].ja} <span className="text-slate-400">{STATE_LABELS[s].en}</span>
              </div>
              <div className="font-outfit text-2xl font-semibold tabular-nums text-[#0a1b33]">{counts[s]}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {byEdition.map((e) => `${md(e.edition)} 版 ${e.total}件（${EARLIER_STATES.filter((s) => e.counts[s] > 0).map((s) => `${STATE_LABELS[s].ja} ${e.counts[s]}`).join("・")}）`).join(" / ")}
        </p>
      </div>
    </section>
  );
}

function CurrentCondition({ r }: { r: ConditionRow }) {
  return (
    <li className="space-y-1">
      <p className="text-[13px] leading-relaxed text-slate-800">{r.question}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-slate-500">
        <span>
          期日 <span className="text-slate-400">Deadline</span> <span className="font-semibold text-slate-700">{r.target_date}</span>
        </span>
        {(r.success_conditions ?? []).map((sc, i) => (
          <span key={i} className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-600">
            {sc.metric} {sc.operator} {sc.threshold.value.toLocaleString("en-US")} {sc.threshold.unit}
          </span>
        ))}
        <Badge state="before" />
      </div>
    </li>
  );
}

function Earlier({ e }: { e: EarlierRow }) {
  return (
    <li className="space-y-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-col-reverse gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
        <p className="min-w-0 text-[13px] leading-relaxed text-slate-700">
          <a href={e.edition_url} target="_blank" rel="noreferrer" className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500 hover:underline">
            {md(e.edition)} 版
          </a>
          {e.question}
        </p>
        <Badge state={e.state} />
      </div>
      <div className="text-[11px] tabular-nums text-slate-500">
        {e.state === "judged" && e.result ? (
          <>
            <span className={`font-semibold ${RESULT_STYLE[e.result] ?? ""}`}>
              {RESULT_LABELS[e.result]?.ja ?? e.result} {RESULT_LABELS[e.result]?.en ?? ""}
            </span>
            {" · "}期日 {e.target_date}
            {e.evidence_url && (
              <>
                {" · "}
                <a href={e.evidence_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                  根拠 evidence
                </a>
              </>
            )}
          </>
        ) : e.state === "before" ? (
          <>
            判定予定 <span className="text-slate-400">Judged on</span> <span className="font-semibold text-slate-700">期日 {e.target_date}</span>
          </>
        ) : e.state === "awaiting" ? (
          <>期日 {e.target_date} を過ぎ、判定待ち <span className="text-slate-400">deadline passed, verdict pending</span></>
        ) : (
          <>期日 {e.target_date}</>
        )}
      </div>
      {e.state === "judged" && e.reasoning && <p className="text-[11px] leading-relaxed text-slate-500">{e.reasoning}</p>}
      {e.next && (
        <p className="text-[11px] leading-relaxed text-slate-500">
          {e.next.by === "rewrite" ? "差し替え先 Replaced by" : "次の版 Carried into"}：{e.next.question}
          <span className="tabular-nums text-slate-400">（期日 {e.next.target_date}）</span>
        </p>
      )}
      {e.replaced_reason && <p className="text-[11px] text-slate-500">差し替え Replaced：{e.replaced_reason}</p>}
      {e.article_note && (
        <p className="text-[11px] leading-relaxed text-slate-600">
          <span className="rounded bg-violet-50 px-1 font-semibold text-violet-700">
            記事上の評価{e.article_note.edition ? `（${md(e.article_note.edition)} 版）` : ""}
          </span>{" "}
          {e.article_note.text}{" "}
          <span className="text-slate-400">— the article&apos;s own assessment, not a verdict</span>
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
export function NeocloudCompanyCard({ c }: { c: NeocloudCard }) {
  const ne = c.next_earnings;
  const cp = c.power.contracted_power_mw;
  const en = c.power.energized_mw;
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-outfit text-lg font-semibold text-[#0a1b33]">{c.company}</span>
          <span className="font-mono text-[12px] text-slate-500">{c.ticker}</span>
          {!c.listed && <span className="text-[11px] text-slate-400">未上場 unlisted</span>}
          {!c.member && <span className="text-[11px] text-slate-400">· 最新版で対象外 not in the latest edition</span>}
        </div>
        {c.group && <div className="text-[11px] font-semibold text-slate-500">{c.group}</div>}
        {c.member && c.listed && (
          <div className="text-[12px] tabular-nums text-slate-600">
            次の決算 <span className="text-slate-400">Next earnings</span>{" "}
            {ne.date ? <span className="font-semibold text-slate-800">{ne.date}</span> : "—"}{" "}
            <span className={ne.kind === "confirmed" ? "text-emerald-700" : "text-slate-400"}>
              （{EARNINGS_KIND[ne.kind].ja} {EARNINGS_KIND[ne.kind].en}）
            </span>
          </div>
        )}
        {(cp || en) && (
          <div className="text-[12px] tabular-nums text-slate-600">
            {cp?.value != null && (
              <>
                契約電力 <span className="font-semibold text-slate-800">{formatMetric(cp.value, cp.unit)}</span>
              </>
            )}
            {cp?.value != null && en?.value != null && " · "}
            {en?.value != null && (
              <>
                稼働 <span className="font-semibold text-slate-800">{formatMetric(en.value, en.unit)}</span>
              </>
            )}
            <span className="text-slate-400"> （{(cp ?? en)?.as_of}）</span>
          </div>
        )}
      </header>

      {c.member && (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-[#0a1b33]">
            <Bi ja="今の条件" en="Current condition" />
          </h3>
          {c.current.length ? (
            <ul className="space-y-2">
              {c.current.map((r) => (
                <CurrentCondition key={r.id} r={r} />
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-slate-400">期日前の条件なし No condition before its deadline</p>
          )}
        </section>
      )}

      {c.earlier.length > 0 && (
        <section>
          <h3 className="mb-1 text-[12px] font-semibold text-[#0a1b33]">
            <Bi ja="10/20 版より前の条件" en="Earlier editions (7/31, 7/21)" />
          </h3>
          <ul className="space-y-2">
            {c.earlier.map((e) => (
              <Earlier key={e.id} e={e} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
