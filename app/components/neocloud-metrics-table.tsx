import { METRIC_ITEMS, METRIC_LABELS_JA, type MetricItem, type PublicMetric } from "@/lib/neocloud";

type Lang = "en" | "ja";
const t = (lang: Lang, en: string, ja: string) => (lang === "ja" ? ja : en);
const METRIC_LABELS_EN: Record<MetricItem, string> = {
  contracted_power_mw: "Contracted power",
  energized_mw: "Energized",
  backlog_usd: "Backlog / RPO",
  revenue_guidance: "Revenue guidance",
  capex_guidance: "Capex guidance",
  financing: "Financing",
  key_contracts: "Key contracts",
};

/** A disclosed number as people read it: MW, $bn / $m, 億円. */
export function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "MW") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} MW`;
  if (unit === "USD") {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })}bn`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m`;
    return `$${value.toLocaleString("en-US")}`;
  }
  if (unit === "JPY") {
    if (Math.abs(value) >= 1e8) return `${(value / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円`;
    return `${value.toLocaleString("ja-JP")}円`;
  }
  return `${value.toLocaleString("en-US")} ${unit}`;
}

function valueText(r: PublicMetric, lang: Lang = "en"): string {
  if (r.low != null || r.high != null) {
    const lo = r.low != null ? formatMetric(r.low, r.unit) : "?";
    const hi = r.high != null ? formatMetric(r.high, r.unit) : "?";
    return `${lo} – ${hi}`;
  }
  return r.value === null && !r.detail ? t(lang, "not stated", "開示なし") : formatMetric(r.value, r.unit);
}

function detailText(r: PublicMetric): string {
  const d = (r.detail ?? {}) as Record<string, unknown>;
  const parts = [
    r.period,
    d.instrument,
    d.counterparty,
    d.rate,
    d.maturity ? `due ${d.maturity}` : null,
    d.term,
    d.mw ? `${d.mw} MW` : null,
    d.lender,
  ]
    .filter((x) => x !== null && x !== undefined && x !== "")
    .map(String);
  return parts.join(" · ");
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

/**
 * Per company, every recorded number by item, oldest first, each with its
 * document. Companies with nothing recorded are listed in one line at the end.
 */
export function NeocloudMetricsTable({
  companies,
  lang = "en",
}: {
  companies: Array<{ ticker: string; company: string; listed: boolean; series: PublicMetric[] }>;
  lang?: Lang;
}) {
  const withRows = companies.filter((c) => c.series.length > 0);
  const without = companies.filter((c) => c.series.length === 0);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-outfit text-xl font-semibold text-[#0a1b33]">{t(lang, "Numbers from the filings", "開示書類の数値")}</h2>
        <p className="text-[12px] text-slate-500">
          {t(
            lang,
            "Each number as the document states it (no estimates), by the date it is as of. “not stated”: the document was read and does not state it.",
            "書類に書いてある数字そのもの（推定はしない）を、時点の順に。「開示なし」は、書類を読んだが書いていないもの。",
          )}
        </p>
      </div>
      {withRows.map((c) => (
        <details key={c.ticker} className="rounded-2xl border border-slate-200 bg-white shadow-sm" open={withRows.length <= 4}>
          <summary className="cursor-pointer px-4 py-3">
            <span className="font-semibold text-[#0a1b33]">{c.ticker}</span>{" "}
            <span className="text-[12px] text-slate-500">{c.company}</span>
            <span className="ml-2 text-[11px] text-slate-400">{t(lang, `${c.series.length} rows`, `${c.series.length}行`)}</span>
          </summary>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2">{t(lang, "Item", "項目")}</th>
                  <th className="px-4 py-2">{t(lang, "As of", "時点")}</th>
                  <th className="px-4 py-2">{t(lang, "Value", "値")}</th>
                  <th className="px-4 py-2">{t(lang, "Detail", "詳細")}</th>
                  <th className="px-4 py-2">{t(lang, "Document", "書類")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {METRIC_ITEMS.flatMap((item) =>
                  c.series
                    .filter((r) => r.item === item)
                    .map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{lang === "ja" ? METRIC_LABELS_JA[item] : METRIC_LABELS_EN[item]}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">{r.as_of}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-semibold tabular-nums text-[#0a1b33]">{valueText(r, lang)}</td>
                        <td className="max-w-[18rem] px-4 py-2 text-slate-500">{detailText(r) || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <a href={r.source_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                            {hostOf(r.source_url)}
                          </a>{" "}
                          <span className="tabular-nums text-slate-400">{r.published_at}</span>
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      {without.length > 0 && (
        <p className="text-[12px] text-slate-400">
          {t(lang, "Not recorded yet: ", "まだ記録がない会社：")}
          {without.map((c) => `${c.ticker}${c.listed ? "" : t(lang, " (unlisted)", "（未上場）")}`).join(t(lang, ", ", "、"))}
        </p>
      )}
    </section>
  );
}
