/**
 * The stock brief the MCP tools serve: for one ticker, what a trader checks
 * before an earnings report — the last quarter as filed (with year-over-year),
 * the next earnings date, the latest filings, the condition this site has set
 * and the verdicts so far. Every number carries the filing it came from. No
 * model, no paid API: SEC EDGAR (free, public) and the committed records.
 */
import { conditionsFor, nextEarningsOf, type Records } from "@/lib/company-record";
import { filingIndexUrl, getSecRecord, JUDGEABLE, type SecRecord, type SecSeries, type SecValue } from "@/lib/edgar";
import { hitRateOf, tally } from "@/lib/hit-rate";

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** The same quarter a year earlier (end within ±20 days of 365 days before). Pure. */
export function yearAgo(series: SecValue[], v: SecValue): SecValue | null {
  return series.find((x) => Math.abs(days(x.end, v.end) - 365) <= 20) ?? null;
}

/**
 * A fiscal Q4 is not tagged as a quarter (a 10-K tags the year): when the year
 * is newer than the latest tagged quarter, Q4 = the year less its three tagged
 * quarters. Only for additive metrics (not EPS). Pure.
 */
export function withDerivedQ4(s: SecSeries, additive: boolean): { latest: SecValue; derived: boolean } | null {
  const q = s.quarterly[0];
  const fy = s.annual[0];
  if (additive && fy && (!q || fy.end > q.end)) {
    const v = q4Of(s, fy);
    if (v) return { latest: v, derived: true };
  }
  return q ? { latest: q, derived: false } : null;
}

/** The fiscal Q4 of the year `fy`: the year less its three tagged quarters, or null. Pure. */
export function q4Of(s: SecSeries, fy: SecValue): SecValue | null {
  if (!fy.start) return null;
  const inYear = s.quarterly.filter((x) => x.start && x.start >= fy.start! && x.end < fy.end);
  if (inYear.length !== 3) return null;
  return { ...fy, start: inYear.map((x) => x.end).sort().pop()!, value: fy.value - inYear.reduce((a, x) => a + x.value, 0) };
}

/** One metric's latest quarter, with YoY and the filing URL. Pure. */
export function latestQuarter(cik: string, s: SecSeries | undefined, additive = true) {
  const pick = s ? withDerivedQ4(s, additive) : null;
  if (!s || !pick) return null;
  const v = pick.latest;
  const prevFy = pick.derived ? s.annual.find((a) => Math.abs(days(a.end, v.end) - 365) <= 20) : undefined;
  const prev = pick.derived ? (prevFy ? q4Of(s, prevFy) : null) : yearAgo(s.quarterly, v);
  return {
    period_end: v.end,
    value: v.value,
    unit: s.unit,
    how: pick.derived ? "fiscal Q4 = full year less Q1–Q3 (10-K tags the year)" : "as filed",
    yoy: prev && prev.value !== 0 ? Number(((v.value - prev.value) / Math.abs(prev.value)).toFixed(4)) : null,
    year_ago: prev ? { period_end: prev.end, value: prev.value } : null,
    form: v.form,
    filed: v.filed,
    tag: s.tag,
    document: filingIndexUrl(cik, v.accession),
  };
}

/** Assemble the brief from the SEC record (may be null) and the committed records. Pure. */
export function buildBrief(ticker: string, sec: SecRecord | null, rec: Records, today: string, name?: string | null) {
  const want = ticker.toUpperCase();
  // As in Selection: one stock × one earnings is one prediction — of the weekly
  // picks' conditions on the same report, the latest week's stands.
  const all = conditionsFor(want, rec, today).filter((r) => r.status !== "superseded");
  const latestWeek = new Map<string, string>();
  for (const r of all) {
    if (!r.week_of) continue;
    const k = `${r.population}|${r.target_date}`;
    if (!latestWeek.has(k) || r.week_of > latestWeek.get(k)!) latestWeek.set(k, r.week_of);
  }
  const rows = all.filter((r) => !r.week_of || latestWeek.get(`${r.population}|${r.target_date}`) === r.week_of);
  const current = rows
    .filter((r) => r.status === "active" || r.status === "expired")
    .sort((a, b) => a.target_date.localeCompare(b.target_date));
  const judged = rows.filter((r) => r.status === "judged").sort((a, b) => b.target_date.localeCompare(a.target_date));
  const counts = tally(judged.map((r) => r.result));
  return {
    ticker: want,
    company: sec?.company ?? name ?? null,
    next_earnings: nextEarningsOf(want, rec, today),
    last_quarter: sec
      ? Object.fromEntries(JUDGEABLE.map((m) => [m, latestQuarter(sec.cik, sec.financials[m], m !== "eps_diluted")]))
      : null,
    recent_filings: sec ? sec.filings.slice(0, 8) : [],
    conditions_open: current.map((r) => ({
      condition: r.question,
      target_date: r.target_date,
      status: r.status === "expired" ? "awaiting verdict" : "pending",
      source: r.population,
    })),
    track_record: {
      judged: judged.length,
      counts: { hit: counts.hit, partial: counts.partial, miss: counts.miss, na: counts.na },
      hit_rate: hitRateOf(counts),
      latest: judged.slice(0, 5).map((r) => ({
        condition: r.question,
        target_date: r.target_date,
        result: r.result,
        evidence_url: r.evidence_url,
      })),
    },
    sources: sec ? ["SEC EDGAR (filings, XBRL)", "OSD conditions and verdicts"] : ["OSD conditions and verdicts"],
    note: sec ? undefined : "Not an SEC filer (e.g. a Japanese or European listing, or an ETF): no EDGAR filings or financials.",
  };
}

/** Fetch and assemble. Throws only if SEC is unreachable. */
export async function getStockBrief(ticker: string, rec: Records, today: string, name?: string | null) {
  const sec = await getSecRecord(ticker);
  return buildBrief(ticker, sec, rec, today, name);
}
