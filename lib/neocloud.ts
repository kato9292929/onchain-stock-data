import { promises as fs } from "node:fs";
import path from "node:path";
import {
  conditionsFor,
  latestVerdict,
  nextEarningsOf,
  type NextEarnings,
  type Records,
} from "@/lib/company-record";
import type { ThemeDef, ThemesFile } from "@/lib/theme-members";

/**
 * Neocloud: the companies of the two neocloud themes (US 18, JP 5) and their
 * business numbers, recorded each time a filing discloses one.
 *
 *   data/neocloud-metrics.json   one row per disclosed number (company · item ·
 *                                value · unit · as-of · document URL · filed
 *                                date), written by import:chat (type metrics).
 *                                No estimates: an item the filing does not
 *                                state is a row with value null, or no row.
 *   data/neocloud-filings.json   filing metadata (form, date, URL) found by
 *                                export:chat on EDGAR / TDnet. Metadata only.
 *
 * Static reads only; a missing file is an empty record.
 */

export const NEOCLOUD_THEME_IDS = ["neocloud-us", "neocloud-jp"] as const;

export const METRIC_ITEMS = [
  "contracted_power_mw",
  "energized_mw",
  "backlog_usd",
  "revenue_guidance",
  "capex_guidance",
  "financing",
  "key_contracts",
] as const;
export type MetricItem = (typeof METRIC_ITEMS)[number];

/** Items measured in MW; every other item is money (USD or JPY, full amount). */
export const POWER_ITEMS: readonly MetricItem[] = ["contracted_power_mw", "energized_mw"];
export const MONEY_UNITS = ["USD", "JPY"] as const;

export const METRIC_LABELS_JA: Record<MetricItem, string> = {
  contracted_power_mw: "契約済みの電力容量",
  energized_mw: "稼働している容量",
  backlog_usd: "受注残・RPO",
  revenue_guidance: "売上ガイダンス",
  capex_guidance: "設備投資ガイダンス",
  financing: "資金調達",
  key_contracts: "主要な契約",
};

export interface MetricRow {
  id: string;
  ticker: string;
  market: "US" | "JP";
  item: MetricItem;
  /** The disclosed number, in `unit`. null: the document does not state it. */
  value: number | null;
  /** "MW" for power items; "USD" or "JPY" (full amount) otherwise. */
  unit: string;
  /** The date the number is as of (quarter end, announcement date). */
  as_of: string;
  /** Guidance only: the period it covers, e.g. "FY2026", "Q4 2026". */
  period?: string | null;
  /** Guidance given as a range. */
  low?: number | null;
  high?: number | null;
  /** financing / key_contracts: instrument, rate, maturity, counterparty, term, mw … */
  detail?: Record<string, unknown> | null;
  source_url: string;
  /** The filing / release date of the document. */
  published_at: string;
  note?: string | null;
  added_at?: string;
  added_by?: string;
}

export interface NeocloudMetricsFile {
  note?: string;
  updated_at: string | null;
  metrics: MetricRow[];
}

export interface FilingRow {
  ticker: string;
  market: "US" | "JP";
  form: string;
  title: string;
  filed_at: string;
  url: string;
}

export interface NeocloudFilingsFile {
  note?: string;
  updated_at: string | null;
  filings: FilingRow[];
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export const getNeocloudMetrics = () =>
  readJson<NeocloudMetricsFile>("neocloud-metrics.json", { updated_at: null, metrics: [] });
export const getNeocloudFilings = () =>
  readJson<NeocloudFilingsFile>("neocloud-filings.json", { updated_at: null, filings: [] });

// ── companies ─────────────────────────────────────────────────────────────

export interface NeocloudCompany {
  ticker: string;
  company: string;
  market: "US" | "JP";
  listed: boolean;
  group: string | null;
  theme: string;
}

/** The article members of the two neocloud themes (US first). */
export function neocloudCompanies(themes: ThemesFile | null | undefined): NeocloudCompany[] {
  const out: NeocloudCompany[] = [];
  for (const id of NEOCLOUD_THEME_IDS) {
    const t = themes?.themes.find((x) => x.id === id);
    for (const m of t?.members ?? []) {
      out.push({
        ticker: m.ticker.toUpperCase(),
        company: m.company ?? m.ticker,
        market: t!.market === "JP" ? "JP" : "US",
        listed: m.listed !== false,
        group: m.group ?? null,
        theme: id,
      });
    }
  }
  return out;
}

export function findNeocloudCompany(themes: ThemesFile | null | undefined, ticker: string) {
  const want = ticker.trim().toUpperCase();
  return neocloudCompanies(themes).find((c) => c.ticker === want) ?? null;
}

export const isNeocloudTheme = (t: Pick<ThemeDef, "id">) => (NEOCLOUD_THEME_IDS as readonly string[]).includes(t.id);

// ── rows ──────────────────────────────────────────────────────────────────

/** A row as responses show it (no import bookkeeping). */
export function publicMetric(r: MetricRow) {
  return {
    id: r.id,
    item: r.item,
    value: r.value,
    unit: r.unit,
    as_of: r.as_of,
    period: r.period ?? null,
    low: r.low ?? null,
    high: r.high ?? null,
    detail: r.detail ?? null,
    source_url: r.source_url,
    published_at: r.published_at,
    note: r.note ?? null,
  };
}
export type PublicMetric = ReturnType<typeof publicMetric>;

const newestFirst = (a: MetricRow, b: MetricRow) =>
  a.as_of !== b.as_of ? (a.as_of < b.as_of ? 1 : -1) : a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0;

const stated = (r: MetricRow) => r.value !== null || r.low != null || r.high != null || r.detail != null;

function rowsOf(file: NeocloudMetricsFile | null | undefined, ticker: string) {
  const want = ticker.toUpperCase();
  return (file?.metrics ?? []).filter((r) => r.ticker.toUpperCase() === want);
}

/**
 * The latest row per item: the newest row that states something, else the
 * newest row (a "not disclosed" null), else null.
 */
export function latestMetrics(file: NeocloudMetricsFile | null | undefined, ticker: string) {
  const rows = rowsOf(file, ticker);
  const out = {} as Record<MetricItem, PublicMetric | null>;
  for (const item of METRIC_ITEMS) {
    const mine = rows.filter((r) => r.item === item).sort(newestFirst);
    const pick = mine.find(stated) ?? mine[0] ?? null;
    out[item] = pick ? publicMetric(pick) : null;
  }
  return out;
}

/** Every row of one company, item order, oldest first within an item. */
export function metricSeries(file: NeocloudMetricsFile | null | undefined, ticker: string) {
  const order = new Map(METRIC_ITEMS.map((x, i) => [x, i]));
  return rowsOf(file, ticker)
    .sort((a, b) => (order.get(a.item)! - order.get(b.item)!) || -newestFirst(a, b))
    .map(publicMetric);
}

/** Documents behind a company's rows, newest first. */
export function metricDocuments(file: NeocloudMetricsFile | null | undefined, ticker: string) {
  const seen = new Map<string, { url: string; published_at: string; items: Set<string> }>();
  for (const r of rowsOf(file, ticker)) {
    const d = seen.get(r.source_url) ?? { url: r.source_url, published_at: r.published_at, items: new Set() };
    d.items.add(r.item);
    seen.set(r.source_url, d);
  }
  return [...seen.values()]
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
    .map((d) => ({ url: d.url, published_at: d.published_at, items: [...d.items] }));
}

const mw = (m: PublicMetric | null) => (m && m.unit === "MW" && typeof m.value === "number" ? m.value : null);

/**
 * Market totals of the latest contracted and energized MW. Only companies that
 * disclosed a number are summed; how many did is returned beside the sum.
 */
export function powerTotals(
  companies: readonly NeocloudCompany[],
  file: NeocloudMetricsFile | null | undefined,
) {
  const out = {
    US: { contracted_power_mw: 0, contracted_companies: 0, energized_mw: 0, energized_companies: 0, companies: 0 },
    JP: { contracted_power_mw: 0, contracted_companies: 0, energized_mw: 0, energized_companies: 0, companies: 0 },
  };
  for (const c of companies) {
    const t = out[c.market];
    t.companies += 1;
    const l = latestMetrics(file, c.ticker);
    const cp = mw(l.contracted_power_mw);
    const en = mw(l.energized_mw);
    if (cp !== null) {
      t.contracted_power_mw += cp;
      t.contracted_companies += 1;
    }
    if (en !== null) {
      t.energized_mw += en;
      t.energized_companies += 1;
    }
  }
  return out;
}

// ── recent disclosures ────────────────────────────────────────────────────

const daysBefore = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** The window "the last 7 days" means: today and the 6 days before it. */
export const windowStart = (today: string, days = 7) => daysBefore(today, days - 1);

function previousOf(all: readonly MetricRow[], r: MetricRow): MetricRow | null {
  return (
    all
      .filter((x) => x.ticker === r.ticker && x.item === r.item && x.id !== r.id && x.unit === r.unit && stated(x))
      .filter((x) => x.as_of < r.as_of || (x.as_of === r.as_of && x.published_at < r.published_at))
      .sort(newestFirst)[0] ?? null
  );
}

/** A disclosed number beside the one before it, for the digest. */
export function metricChange(all: readonly MetricRow[], r: MetricRow) {
  const prev = previousOf(all, r);
  const change =
    prev && typeof prev.value === "number" && typeof r.value === "number" ? r.value - prev.value : null;
  return {
    ...publicMetric(r),
    previous: prev ? { value: prev.value, unit: prev.unit, as_of: prev.as_of, source_url: prev.source_url } : null,
    change,
  };
}

interface DigestInput {
  themes: ThemesFile | null | undefined;
  metrics: NeocloudMetricsFile | null | undefined;
  filings: NeocloudFilingsFile | null | undefined;
  signals: Records["signals"];
  today: string;
  days?: number;
}

function digestParts({ themes, metrics, filings, signals, today, days = 7 }: DigestInput) {
  const from = windowStart(today, days);
  const inWindow = (d: string | null | undefined) => Boolean(d) && d! >= from && d! <= today;
  return neocloudCompanies(themes)
    .map((c) => {
      const f = (filings?.filings ?? [])
        .filter((x) => x.ticker.toUpperCase() === c.ticker && inWindow(x.filed_at))
        .sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1));
      const m = (metrics?.metrics ?? []).filter((x) => x.ticker.toUpperCase() === c.ticker && inWindow(x.published_at));
      const s = (signals?.signals ?? []).filter((x) => {
        const sx = x as typeof x & { observed_at?: string; source_url?: string };
        return (sx.tickers ?? []).some((t) => t.toUpperCase() === c.ticker) && inWindow(sx.observed_at ?? sx.added_at?.slice(0, 10));
      });
      const dates = [...f.map((x) => x.filed_at), ...m.map((x) => x.published_at)].sort();
      return { c, f, m, s, latest: dates.at(-1) ?? null };
    })
    .filter((x) => x.f.length + x.m.length + x.s.length > 0)
    .sort((a, b) => ((a.latest ?? "") < (b.latest ?? "") ? 1 : -1));
}

/** GET /api/neocloud/digest — free: companies with a disclosure in the window. */
export function digestFreeBody(input: DigestInput, baseUrl: string) {
  const days = input.days ?? 7;
  const parts = digestParts(input);
  return {
    window: { from: windowStart(input.today, days), to: input.today, days },
    company_count: parts.length,
    disclosure_count: parts.reduce((n, x) => n + Math.max(x.f.length, new Set(x.m.map((r) => r.source_url)).size), 0),
    companies: parts.map(({ c, f, m, latest }) => ({
      ticker: c.ticker,
      company: c.company,
      market: c.market,
      theme: c.theme,
      filings: f.length,
      forms: [...new Set(f.map((x) => x.form))],
      new_metrics: m.length,
      latest_disclosed_at: latest,
    })),
    full: { url: `${baseUrl}/api/neocloud/digest?view=full`, price_usdc: "0.001", network: "solana", scheme: "exact" },
  };
}

/** GET /api/neocloud/digest?view=full — paid: the filings, the summaries and how the numbers moved. */
export function digestFullBody(input: DigestInput) {
  const days = input.days ?? 7;
  const all = input.metrics?.metrics ?? [];
  const parts = digestParts(input);
  return {
    window: { from: windowStart(input.today, days), to: input.today, days },
    company_count: parts.length,
    companies: parts.map(({ c, f, m, s, latest }) => ({
      ticker: c.ticker,
      company: c.company,
      market: c.market,
      theme: c.theme,
      latest_disclosed_at: latest,
      filings: f.map((x) => ({ form: x.form, title: x.title, filed_at: x.filed_at, url: x.url })),
      summaries: s.map((x) => {
        const sx = x as typeof x & { observed_at?: string; source_url?: string };
        return {
          claim: x.claim,
          basis: x.basis ?? null,
          direction: x.direction,
          observed_at: sx.observed_at ?? null,
          source_url: sx.source_url ?? x.source,
          verified: x.verified,
        };
      }),
      metric_changes: m.map((r) => metricChange(all, r)),
    })),
  };
}

// ── company ───────────────────────────────────────────────────────────────

interface CompanyInput {
  company: NeocloudCompany;
  rec: Records;
  metrics: NeocloudMetricsFile | null | undefined;
  filings: NeocloudFilingsFile | null | undefined;
  today: string;
}

const nextEarnings = (c: NeocloudCompany, rec: Records, today: string): NextEarnings | null =>
  c.listed ? nextEarningsOf(c.ticker, rec, today) : null;

/** GET /api/neocloud/{ticker} — free: the latest number per item. */
export function companyFreeBody({ company: c, rec, metrics, today }: CompanyInput, baseUrl: string) {
  const rows = rowsOf(metrics, c.ticker);
  return {
    ticker: c.ticker,
    company: c.company,
    market: c.market,
    theme: c.theme,
    listed: c.listed,
    group: c.group,
    next_earnings: nextEarnings(c, rec, today),
    latest: latestMetrics(metrics, c.ticker),
    metric_rows: rows.length,
    updated_at: rows.map((r) => r.published_at).sort().at(-1) ?? null,
    full: {
      url: `${baseUrl}/api/neocloud/${encodeURIComponent(c.ticker)}?view=full`,
      price_usdc: "0.001",
      network: "solana",
      scheme: "exact",
    },
  };
}

/** GET /api/neocloud/{ticker}?view=full — paid: the series, conditions, verdicts and documents. */
export function companyFullBody({ company: c, rec, metrics, filings, today }: CompanyInput) {
  const conditions = conditionsFor(c.ticker, rec, today);
  return {
    ticker: c.ticker,
    company: c.company,
    market: c.market,
    theme: c.theme,
    listed: c.listed,
    group: c.group,
    next_earnings: nextEarnings(c, rec, today),
    latest: latestMetrics(metrics, c.ticker),
    series: metricSeries(metrics, c.ticker),
    conditions,
    latest_verdict: latestVerdict(conditions),
    documents: metricDocuments(metrics, c.ticker),
    filings: (filings?.filings ?? [])
      .filter((f) => f.ticker.toUpperCase() === c.ticker)
      .sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1))
      .map((f) => ({ form: f.form, title: f.title, filed_at: f.filed_at, url: f.url })),
  };
}

// ── theme additions ───────────────────────────────────────────────────────

/** Per-member power figures for the free theme response. */
export function memberPower(file: NeocloudMetricsFile | null | undefined, ticker: string) {
  const l = latestMetrics(file, ticker);
  return { contracted_power_mw: l.contracted_power_mw, energized_mw: l.energized_mw };
}

/** The companies whose confirmed earnings date is nearest (listed only). */
export function nextReporters(
  companies: readonly NeocloudCompany[],
  rec: Records,
  today: string,
  n = 3,
) {
  return companies
    .filter((c) => c.listed)
    .map((c) => ({ c, ne: nextEarningsOf(c.ticker, rec, today) }))
    .filter((x) => x.ne.status === "confirmed" && x.ne.date)
    .sort((a, b) => (a.ne.date! < b.ne.date! ? -1 : 1))
    .slice(0, n)
    .map(({ c, ne }) => ({ ticker: c.ticker, company: c.company, market: c.market, date: ne.date!, source_url: ne.source_url }));
}
