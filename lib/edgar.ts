/**
 * SEC EDGAR — the company's own filings and XBRL financials, for any US-listed
 * ticker. Free public API (no key, no paid data API, no model call). SEC asks
 * for a User-Agent that names the client; it names this site, not a person.
 * Fair-access limit is 10 requests/second; one paid call makes at most
 * 1 + 1 + CONCEPTS.length requests, each cached for a day.
 *
 *   ticker → CIK        https://www.sec.gov/files/company_tickers.json
 *   filings             https://data.sec.gov/submissions/CIK##########.json
 *   financials          https://data.sec.gov/api/xbrl/companyconcept/CIK##########/{taxonomy}/{tag}.json
 *
 * Values are exactly what the company tagged in its 10-K / 10-Q (or 20-F /
 * 40-F); each carries the form, the accession number and the filed date. A
 * metric the company does not tag is absent, never estimated.
 */

export const SEC_SOURCE = "SEC EDGAR (company filings, XBRL)";
const UA = "onchain-stock-data (+https://osd-coral.vercel.app)";
const DAY = 24 * 60 * 60;

// SEC fair access: at most 10 requests/second per client. Keep this process at
// 8/s by spacing the start of each request (cached responses count too — the
// cost is a little latency, never a block).
const MIN_GAP_MS = 125;
let nextSlot = 0;
async function slot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function secJson<T>(url: string): Promise<T | null> {
  await slot();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: DAY },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SEC ${res.status} for ${url}`);
  return (await res.json()) as T;
}

const pad = (cik: number) => String(cik).padStart(10, "0");

/** Our tickers write share classes with a dot (BRK.B); SEC uses a dash (BRK-B). */
export function secTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

let tickerMap: { at: number; map: Map<string, { cik: number; title: string }> } | null = null;

/** SEC's ticker → CIK list, kept in memory for a day within one process. */
export async function secTickerMap(): Promise<Map<string, { cik: number; title: string }>> {
  if (tickerMap && Date.now() - tickerMap.at < DAY * 1000) return tickerMap.map;
  const all = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  const map = new Map<string, { cik: number; title: string }>();
  for (const v of Object.values(all ?? {})) if (!map.has(v.ticker.toUpperCase())) map.set(v.ticker.toUpperCase(), { cik: v.cik_str, title: v.title });
  tickerMap = { at: Date.now(), map };
  return map;
}

export async function cikFor(ticker: string): Promise<{ cik: number; title: string } | null> {
  return (await secTickerMap()).get(secTicker(ticker)) ?? null;
}

// ── filings ─────────────────────────────────────────────────────────────────

export interface SecFiling {
  form: string;
  filed: string;
  report_date: string | null;
  accession: string;
  description: string | null;
  url: string;
}

interface Submissions {
  name?: string;
  filings?: {
    recent?: {
      form: string[];
      filingDate: string[];
      reportDate: string[];
      accessionNumber: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

/** Newest first, the latest `n`. Pure. */
export function filingsFromSubmissions(cik: number, s: Submissions | null, n = 20): SecFiling[] {
  const r = s?.filings?.recent;
  if (!r) return [];
  const out: SecFiling[] = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    const accn = r.accessionNumber[i];
    out.push({
      form: r.form[i],
      filed: r.filingDate[i],
      report_date: r.reportDate[i] || null,
      accession: accn,
      description: r.primaryDocDescription[i] || null,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${r.primaryDocument[i]}`,
    });
  }
  return out;
}

// ── financials ──────────────────────────────────────────────────────────────

/** Each metric and the tags that carry it, in preference order (companies use different ones). */
export const CONCEPTS: Array<{ key: string; unit: string; tags: Array<[string, string]> }> = [
  {
    key: "revenue",
    unit: "USD",
    tags: [
      ["us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"],
      ["us-gaap", "Revenues"],
      ["us-gaap", "SalesRevenueNet"],
    ],
  },
  { key: "operating_income", unit: "USD", tags: [["us-gaap", "OperatingIncomeLoss"]] },
  { key: "net_income", unit: "USD", tags: [["us-gaap", "NetIncomeLoss"]] },
  { key: "eps_diluted", unit: "USD/shares", tags: [["us-gaap", "EarningsPerShareDiluted"]] },
  { key: "cash", unit: "USD", tags: [["us-gaap", "CashAndCashEquivalentsAtCarryingValue"]] },
  { key: "shares_outstanding", unit: "shares", tags: [["dei", "EntityCommonStockSharesOutstanding"]] },
];

const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "10-K/A", "10-Q/A", "20-F/A"]);

interface Fact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
}

export interface SecValue {
  start: string | null;
  end: string;
  value: number;
  form: string;
  filed: string;
  accession: string;
}

export interface SecSeries {
  tag: string;
  unit: string;
  quarterly: SecValue[];
  annual: SecValue[];
  /** Point-in-time values (balance-sheet items, share counts). */
  instant: SecValue[];
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const toValue = (f: Fact): SecValue => ({ start: f.start ?? null, end: f.end, value: f.val, form: f.form, filed: f.filed, accession: f.accn });

/**
 * One concept's facts → quarterly (≈3-month), annual (≈12-month) and instant
 * series, newest first, one value per period (the latest filing wins, so a
 * restatement replaces the original). Pure.
 */
export function seriesFromConcept(units: Record<string, Fact[]> | undefined, unit: string, tag: string, n = 8): SecSeries | null {
  const facts = (units?.[unit] ?? []).filter((f) => PERIODIC_FORMS.has(f.form) && Number.isFinite(f.val));
  if (facts.length === 0) return null;
  const byPeriod = new Map<string, Fact>();
  for (const f of facts) {
    const k = `${f.start ?? ""}|${f.end}`;
    const cur = byPeriod.get(k);
    if (!cur || f.filed > cur.filed) byPeriod.set(k, f);
  }
  const all = [...byPeriod.values()].sort((a, b) => b.end.localeCompare(a.end));
  const quarterly = all.filter((f) => f.start && days(f.start, f.end) >= 80 && days(f.start, f.end) <= 100);
  const annual = all.filter((f) => f.start && days(f.start, f.end) >= 350 && days(f.start, f.end) <= 380);
  const instant = all.filter((f) => !f.start);
  return {
    tag,
    unit,
    quarterly: quarterly.slice(0, n).map(toValue),
    annual: annual.slice(0, Math.ceil(n / 2)).map(toValue),
    instant: instant.slice(0, n).map(toValue),
  };
}

const newest = (s: SecSeries) => [s.quarterly[0]?.end, s.annual[0]?.end, s.instant[0]?.end].filter(Boolean).sort().pop() ?? "";

async function financialsFor(cik: number): Promise<Record<string, SecSeries>> {
  const out: Record<string, SecSeries> = {};
  await Promise.all(
    CONCEPTS.map(async (c) => {
      const found: SecSeries[] = [];
      for (const [tax, tag] of c.tags) {
        const j = await secJson<{ units?: Record<string, Fact[]> }>(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${pad(cik)}/${tax}/${tag}.json`,
        );
        const s = j ? seriesFromConcept(j.units, c.unit, `${tax}:${tag}`) : null;
        if (s) found.push(s);
      }
      // Companies move between tags over the years: use the one with the newest period.
      found.sort((a, b) => newest(b).localeCompare(newest(a)));
      if (found[0]) out[c.key] = found[0];
    }),
  );
  return dropStale(out);
}

/**
 * A metric the company stopped tagging would otherwise read as current (e.g. a
 * 2013 figure next to 2026 ones). Drop any series whose newest period is more
 * than 400 days older than the company's newest period. Pure.
 */
export function dropStale(fin: Record<string, SecSeries>, maxLagDays = 400): Record<string, SecSeries> {
  const latest = Object.values(fin).map(newest).sort().pop();
  if (!latest) return fin;
  return Object.fromEntries(Object.entries(fin).filter(([, s]) => days(newest(s), latest) <= maxLagDays));
}

export interface SecRecord {
  source: string;
  cik: string;
  company: string;
  filings: SecFiling[];
  financials: Record<string, SecSeries>;
}

/** The SEC record for a US ticker, or null when SEC has no company under it. Throws if SEC is unreachable. */
export async function getSecRecord(ticker: string): Promise<SecRecord | null> {
  const hit = await cikFor(ticker);
  if (!hit) return null;
  const [subs, financials] = await Promise.all([
    secJson<Submissions>(`https://data.sec.gov/submissions/CIK${pad(hit.cik)}.json`),
    financialsFor(hit.cik),
  ]);
  return {
    source: SEC_SOURCE,
    cik: pad(hit.cik),
    company: subs?.name ?? hit.title,
    filings: filingsFromSubmissions(hit.cik, subs),
    financials,
  };
}

// ── judging a condition against the filed number ───────────────────────────

/** The four metrics a stock condition may use: each is tagged in every 10-Q / 10-K, so it can be judged from EDGAR alone. */
export const JUDGEABLE = ["revenue", "operating_income", "net_income", "eps_diluted"] as const;
export type JudgeableMetric = (typeof JUDGEABLE)[number];

export function conceptOf(metric: JudgeableMetric) {
  const c = CONCEPTS.find((x) => x.key === metric);
  if (!c) throw new Error(`unknown metric ${metric}`);
  return c;
}

export interface FiledValue {
  value: number;
  /** "reported": the quarter as tagged; "derived": fiscal Q4 = full year − nine months (10-Ks tag the year, not Q4). */
  how: "reported" | "derived";
  form: string;
  filed: string;
  accession: string;
  tag: string;
}

const near = (a: string, b: string, tol = 10) => Math.abs(days(a, b)) <= tol;

/**
 * The value for the fiscal quarter ending `periodEnd` (± 10 days), from one
 * concept's facts. A Q4 is not tagged as a quarter in a 10-K, so for a flow
 * metric it is derived as the full year less the nine months to Q3. EPS is not
 * additive and is never derived. null when the quarter is not filed yet. Pure.
 */
export function quarterValue(
  units: Record<string, Fact[]> | undefined,
  unit: string,
  periodEnd: string,
  tag: string,
  additive: boolean,
): FiledValue | null {
  const facts = (units?.[unit] ?? []).filter((f) => PERIODIC_FORMS.has(f.form) && Number.isFinite(f.val) && f.start);
  const latest = (xs: Fact[]) => xs.sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const dur = (f: Fact) => days(f.start!, f.end);

  const q = latest(facts.filter((f) => near(f.end, periodEnd) && dur(f) >= 80 && dur(f) <= 100));
  if (q) return { value: q.val, how: "reported", form: q.form, filed: q.filed, accession: q.accn, tag };
  if (!additive) return null;

  const fy = latest(facts.filter((f) => near(f.end, periodEnd) && dur(f) >= 350 && dur(f) <= 380));
  if (!fy) return null;
  const nine = latest(facts.filter((f) => f.start && near(f.start, fy.start!) && dur(f) >= 260 && dur(f) <= 290));
  if (!nine) return null;
  return { value: fy.val - nine.val, how: "derived", form: fy.form, filed: fy.filed, accession: fy.accn, tag };
}

/** Fetch the filed value for a metric and quarter, trying the metric's tags in order. Throws if SEC is unreachable. */
export async function filedQuarterValue(cik: number, metric: JudgeableMetric, periodEnd: string): Promise<FiledValue | null> {
  const c = conceptOf(metric);
  for (const [tax, tag] of c.tags) {
    const j = await secJson<{ units?: Record<string, Fact[]> }>(
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${pad(cik)}/${tax}/${tag}.json`,
    );
    const v = j ? quarterValue(j.units, c.unit, periodEnd, `${tax}:${tag}`, metric !== "eps_diluted") : null;
    if (v) return v;
  }
  return null;
}

export const filingIndexUrl = (cik: number | string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
