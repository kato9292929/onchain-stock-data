/**
 * EDINET (金融庁) API v2 client — live disclosure metadata for JP companies.
 *
 * Terms compliance (baked into every response that uses this):
 *  - 出典明記: SOURCE_LABEL = "出典：金融庁 EDINET" is attached to every payload.
 *  - 加工の明示: PROCESSED_BY states that we filter/reshape the API's
 *    documents.json (type=2) — the original filings themselves are unchanged.
 *  - API経由・週次・キャッシュ: fetched only through the official v2 API, and each
 *    date's document list is cached for a week (Next fetch revalidate), so a
 *    weekly sweep re-reads the same cached lists instead of hammering EDINET.
 *
 * The API key is passed as the `Subscription-Key` query parameter (EDINET v2).
 * It is read from EDINET_API_KEY (a deploy secret) and never logged or returned.
 */

const BASE = "https://api.edinet-fsa.go.jp/api/v2";

/** 規約: 出典表示。Attach verbatim to every response built from EDINET data. */
export const SOURCE_LABEL = "出典：金融庁 EDINET";

/** 規約: 加工の明示。We locate the company's latest annual/quarterly/half-year
 * report by securities code and extract the standard XBRL financial elements
 * (sales / operating income / net income) from the official type=5 CSV; the
 * original filings themselves are not altered. */
export const PROCESSED_BY =
  "onchain-stock-data — EDINET API v2 で当該証券コードの最新の有価証券報告書／" +
  "四半期・半期報告書を特定し、書類取得(type=5 CSV)のXBRL標準要素から" +
  "売上高・営業利益・純利益・会計期間のみ抽出・再整形（原本の開示書類は改変していない）。" +
  "決算短信はTDnet管轄のためEDINETの対象外。";

/** Weekly cache (seconds) for each date's document list and each doc's financials. */
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** Default lookback window (calendar days) for the metadata-only endpoint. */
export const DEFAULT_WINDOW_DAYS = 14;

/**
 * Window (calendar days) scanned to find a company's latest financial report.
 * Post-2024 most filers lodge an 有報 (annual) + 半期 (semi-annual) on EDINET,
 * so ~120 days reliably catches the most recent one for the common March
 * fiscal-year filers; companies with nothing in the window return
 * financials_available:false rather than a fabricated figure.
 */
export const FINANCIAL_WINDOW_DAYS = 120;

/**
 * EDINET doc_type codes that carry audited/reviewed financial statements:
 *   120 = 有価証券報告書 (annual), 140 = 四半期報告書 (quarterly, pre-2024),
 *   160 = 半期報告書 (semi-annual). 決算短信 is NOT here — it is filed on TDnet,
 *   not EDINET, so it is out of scope by design.
 */
export const REPORT_DOC_TYPES = ["120", "140", "160"];

export interface EdinetDoc {
  doc_id: string;
  edinet_code: string | null;
  sec_code: string | null;
  filer_name: string | null;
  doc_description: string | null;
  doc_type_code: string | null;
  submit_datetime: string | null;
  period_start: string | null;
  period_end: string | null;
}

/** Raw EDINET v2 documents.json result row (subset we use). */
interface RawResult {
  docID?: string;
  edinetCode?: string | null;
  secCode?: string | null;
  filerName?: string | null;
  docDescription?: string | null;
  docTypeCode?: string | null;
  submitDateTime?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

function apiKey(): string {
  const k = process.env.EDINET_API_KEY;
  if (!k) throw new Error("EDINET_API_KEY not set");
  return k;
}

/** A 4-digit TSE ticker maps to the EDINET 5-digit securities code by a
 * trailing "0" (e.g. 7203 → 72030). Pass-through for values already 5-digit. */
export function secCodeFor(ticker: string): string {
  const t = String(ticker).trim();
  if (/^\d{4}$/.test(t)) return `${t}0`;
  return t;
}

function reshape(r: RawResult): EdinetDoc {
  return {
    doc_id: r.docID ?? "",
    edinet_code: r.edinetCode ?? null,
    sec_code: r.secCode ?? null,
    filer_name: r.filerName ?? null,
    doc_description: r.docDescription ?? null,
    doc_type_code: r.docTypeCode ?? null,
    submit_datetime: r.submitDateTime ?? null,
    period_start: r.periodStart ?? null,
    period_end: r.periodEnd ?? null,
  };
}

/** Fetch one date's document list (type=2 metadata) via the v2 API. Cached for
 * a week so a weekly sweep never re-hits EDINET for the same date. Returns []
 * for holidays / empty days / any non-200. */
export async function getDocumentsForDate(date: string): Promise<EdinetDoc[]> {
  const url = `${BASE}/documents.json?date=${encodeURIComponent(date)}&type=2&Subscription-Key=${encodeURIComponent(apiKey())}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: WEEK_SECONDS },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: RawResult[] };
  return (json.results ?? []).map(reshape);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Recent filings for one company (by securities code), scanning a cached window
 * of daily lists. Sorted newest-first. Each date list is cached weekly and
 * shared across every ticker in a sweep, so cost to EDINET is bounded by the
 * window size, not by the number of companies queried.
 */
export async function getRecentDocumentsForCompany(
  ticker: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<{ sec_code: string; documents: EdinetDoc[] }> {
  const sec = secCodeFor(ticker);
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    dates.push(ymd(d));
  }
  const lists = await Promise.all(dates.map((d) => getDocumentsForDate(d)));
  const docs = lists
    .flat()
    .filter((doc) => doc.sec_code && doc.sec_code === sec)
    .sort((a, b) => (a.submit_datetime ?? "").localeCompare(b.submit_datetime ?? ""))
    .reverse();
  return { sec_code: sec, documents: docs };
}

// ── Financials extraction ───────────────────────────────────────────────────

export interface EdinetFinancials {
  sec_code: string;
  financials_available: boolean;
  filer_name: string | null;
  doc_id: string | null;
  doc_type_code: string | null;
  doc_description: string | null;
  submit_datetime: string | null;
  period: { start: string | null; end: string | null };
  unit: "JPY";
  sales: number | null;
  operating_income: number | null;
  net_income: number | null;
}

/** Fetch a chunk of dates' lists with bounded concurrency (gentle on EDINET). */
async function fetchDateLists(dates: string[], concurrency = 8): Promise<EdinetDoc[]> {
  const out: EdinetDoc[] = [];
  for (let i = 0; i < dates.length; i += concurrency) {
    const batch = dates.slice(i, i + concurrency);
    const lists = await Promise.all(batch.map((d) => getDocumentsForDate(d)));
    for (const l of lists) out.push(...l);
  }
  return out;
}

/**
 * The company's single latest financial report (有報/四半期/半期) within the
 * scan window, or null if none is filed there. Each date list is weekly-cached
 * and shared, so a sweep pays the window cost once, not per company.
 */
export async function getLatestReport(
  ticker: string,
  windowDays: number = FINANCIAL_WINDOW_DAYS,
): Promise<EdinetDoc | null> {
  const sec = secCodeFor(ticker);
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    dates.push(ymd(d));
  }
  const all = await fetchDateLists(dates);
  const reports = all.filter(
    (doc) =>
      doc.sec_code === sec &&
      doc.doc_type_code != null &&
      REPORT_DOC_TYPES.includes(doc.doc_type_code),
  );
  if (reports.length === 0) return null;
  reports.sort((a, b) => (b.submit_datetime ?? "").localeCompare(a.submit_datetime ?? ""));
  return reports[0];
}

/** Candidate XBRL element local-names (after the ":") per metric, priority order.
 * Namespace-agnostic (jppfs_cor / jpigp_cor / jpcrp_cor …) — we match the local
 * name so JGAAP, IFRS and the "主要な経営指標等" summary are all covered. */
const ELEMENTS: Record<"sales" | "operating_income" | "net_income", string[]> = {
  sales: [
    // JGAAP — primary statement
    "NetSales",
    "OperatingRevenue1",
    "OperatingRevenue2",
    "NetSalesOfCompletedConstructionContracts",
    // IFRS — primary statement
    "RevenueIFRS",
    "NetSalesIFRS",
    "SalesRevenueIFRS",
    "TotalNetRevenuesIFRS",
    "RevenuesUSGAAP",
    // 主要な経営指標等 (Summary of Business Results) — standardized per filing
    "NetSalesSummaryOfBusinessResults",
    "RevenueIFRSSummaryOfBusinessResults",
    "NetSalesIFRSSummaryOfBusinessResults",
    "SalesRevenueIFRSSummaryOfBusinessResults",
    "RevenuesIFRSSummaryOfBusinessResults",
    "OperatingRevenuesSummaryOfBusinessResults",
    "OrdinaryIncomeBankingBusinessSummaryOfBusinessResults",
  ],
  operating_income: [
    // JGAAP
    "OperatingIncome",
    "OperatingProfitLoss",
    // IFRS
    "OperatingProfitLossIFRS",
    "OperatingIncomeLossIFRS",
    "ProfitLossFromOperatingActivitiesIFRS",
    // Summary
    "OperatingIncomeSummaryOfBusinessResults",
    "OperatingProfitLossIFRSSummaryOfBusinessResults",
  ],
  net_income: [
    // JGAAP
    "ProfitLossAttributableToOwnersOfParent",
    "ProfitLoss",
    "NetIncome",
    // IFRS
    "ProfitLossAttributableToOwnersOfParentIFRS",
    "ProfitLossIFRS",
    // Summary
    "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
    "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
    "NetIncomeLossSummaryOfBusinessResults",
  ],
};

interface CsvRow {
  elementId: string; // full 要素ID (with namespace prefix)
  element: string; // local name after ":"
  itemName: string; // 項目名
  contextId: string; // コンテキストID
  relYear: string; // 相対年度
  consolidated: string; // 連結・個別
  periodType: string; // 期間・時点
  unit: string; // 単位
  value: string; // 値
}

/** Parse one EDINET type=5 CSV (UTF-16LE, tab-separated). Throws on a malformed
 * structure (no header / missing key columns) so callers can fail loud rather
 * than silently returning empty. */
function parseCsv(bytes: Uint8Array): CsvRow[] {
  const text = Buffer.from(bytes).toString("utf16le").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const idx = (name: string) => header.findIndex((h) => h.trim() === name);
  const iEl = idx("要素ID");
  const iName = idx("項目名");
  const iCtx = idx("コンテキストID");
  const iRel = idx("相対年度");
  const iCon = idx("連結・個別");
  const iPer = idx("期間・時点");
  const iUnit = idx("単位");
  const iVal = idx("値");
  if (iEl < 0 || iVal < 0) {
    // Not the tab/UTF-16 schema we expect — signal to the caller.
    throw new Error("EDINET CSV: unexpected structure (要素ID/値 columns not found)");
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length <= iEl) continue;
    const elementId = (c[iEl] ?? "").trim();
    const element = elementId.split(":").pop() ?? "";
    if (!element) continue;
    rows.push({
      elementId,
      element,
      itemName: iName >= 0 ? (c[iName] ?? "").trim() : "",
      contextId: iCtx >= 0 ? (c[iCtx] ?? "").trim() : "",
      relYear: iRel >= 0 ? (c[iRel] ?? "").trim() : "",
      consolidated: iCon >= 0 ? (c[iCon] ?? "").trim() : "",
      periodType: iPer >= 0 ? (c[iPer] ?? "").trim() : "",
      unit: iUnit >= 0 ? (c[iUnit] ?? "").trim() : "",
      value: (c[iVal] ?? "").trim(),
    });
  }
  return rows;
}

/** True if the row is the current-period, JPY, monetary value we want. */
function isCurrentJpy(r: CsvRow): boolean {
  const jpy = r.unit.includes("円") || r.unit.toUpperCase().includes("JPY");
  const current = r.relYear === "当期" || r.relYear === "";
  return jpy && current && r.value !== "" && !Number.isNaN(Number(r.value));
}

/** Pick a metric's value from parsed rows: current + JPY, preferring 連結 over 個別,
 * trying each candidate element in priority order. Returns null if none match. */
function pickMetric(rows: CsvRow[], candidates: string[]): number | null {
  for (const pref of ["連結", "個別", ""]) {
    for (const name of candidates) {
      const hit = rows.find(
        (r) =>
          r.element === name &&
          isCurrentJpy(r) &&
          (pref === "" ? true : r.consolidated === pref),
      );
      if (hit) return Number(hit.value);
    }
  }
  return null;
}

/** Download a doc's type=5 CSV bundle and return every parsed row. FAIL LOUD:
 * throws on a fetch error, a non-ZIP payload, or a bundle with no CSV rows — a
 * structural failure is surfaced, not swallowed as "no financials". */
async function fetchReportRows(docId: string): Promise<CsvRow[]> {
  const url = `${BASE}/documents/${encodeURIComponent(docId)}?type=5&Subscription-Key=${encodeURIComponent(apiKey())}`;
  const res = await fetch(url, { next: { revalidate: WEEK_SECONDS } });
  if (!res.ok) throw new Error(`EDINET type=5 fetch failed (${res.status}) for ${docId}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { unzipSync } = await import("fflate");
  const files = unzipSync(buf); // throws if not a valid ZIP
  const rows: CsvRow[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    rows.push(...parseCsv(data));
  }
  if (rows.length === 0) {
    throw new Error(`EDINET type=5 bundle has no parseable CSV rows for ${docId}`);
  }
  return rows;
}

/** Extract the three headline figures from a report. Weekly-cached by docID in
 * Upstash. Fail-loud on structural errors (propagated); a clean parse with no
 * matching element returns nulls (a legitimate "not found", not an error). */
async function extractFinancials(
  docId: string,
): Promise<Pick<EdinetFinancials, "sales" | "operating_income" | "net_income">> {
  const cached = await finCacheGet(docId);
  if (cached) return cached;
  const rows = await fetchReportRows(docId); // fail loud
  const out = {
    sales: pickMetric(rows, ELEMENTS.sales),
    operating_income: pickMetric(rows, ELEMENTS.operating_income),
    net_income: pickMetric(rows, ELEMENTS.net_income),
  };
  await finCacheSet(docId, out);
  return out;
}

/** Debug dump — the raw XBRL element rows of a company's latest report, so the
 * real element IDs for sales/operating income/net income can be confirmed from
 * fact instead of guessed. Current-period / 連結 / JPY rows are surfaced first.
 * Unprocessed; behind the same paywall as the main endpoint. */
export interface EdinetElementDump {
  doc: EdinetDoc | null;
  count: number;
  elements: Array<{
    element_id: string;
    item_name: string;
    context: string;
    rel_year: string;
    consolidated: string;
    period_type: string;
    unit: string;
    value: string;
  }>;
}

export async function dumpReportElements(
  ticker: string,
  windowDays: number = FINANCIAL_WINDOW_DAYS,
  limit = 600,
): Promise<EdinetElementDump> {
  const doc = await getLatestReport(ticker, windowDays);
  if (!doc) return { doc: null, count: 0, elements: [] };
  const rows = await fetchReportRows(doc.doc_id); // fail loud
  const score = (r: CsvRow) =>
    (r.relYear === "当期" ? 4 : 0) +
    (r.consolidated === "連結" ? 2 : 0) +
    (r.unit.includes("円") || r.unit.toUpperCase().includes("JPY") ? 1 : 0);
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  return {
    doc,
    count: rows.length,
    elements: sorted.slice(0, limit).map((r) => ({
      element_id: r.elementId,
      item_name: r.itemName,
      context: r.contextId,
      rel_year: r.relYear,
      consolidated: r.consolidated,
      period_type: r.periodType,
      unit: r.unit,
      value: r.value,
    })),
  };
}

/** Latest real financials for a company (headline P&L from the newest report). */
export async function getCompanyFinancials(
  ticker: string,
  windowDays: number = FINANCIAL_WINDOW_DAYS,
): Promise<EdinetFinancials> {
  const sec = secCodeFor(ticker);
  const base: EdinetFinancials = {
    sec_code: sec,
    financials_available: false,
    filer_name: null,
    doc_id: null,
    doc_type_code: null,
    doc_description: null,
    submit_datetime: null,
    period: { start: null, end: null },
    unit: "JPY",
    sales: null,
    operating_income: null,
    net_income: null,
  };
  const doc = await getLatestReport(ticker, windowDays);
  if (!doc) return base;
  const fin = await extractFinancials(doc.doc_id);
  const available = fin.sales != null || fin.operating_income != null || fin.net_income != null;
  return {
    ...base,
    financials_available: available,
    filer_name: doc.filer_name,
    doc_id: doc.doc_id,
    doc_type_code: doc.doc_type_code,
    doc_description: doc.doc_description,
    submit_datetime: doc.submit_datetime,
    period: { start: doc.period_start, end: doc.period_end },
    sales: fin.sales,
    operating_income: fin.operating_income,
    net_income: fin.net_income,
  };
}

// ── Upstash weekly cache for extracted financials (REST, no SDK) ─────────────

function upstashEnv(): { url?: string; token?: string } {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function finCacheGet(
  docId: string,
): Promise<Pick<EdinetFinancials, "sales" | "operating_income" | "net_income"> | null> {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/edinet:fin:${encodeURIComponent(docId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: string | null };
    return j.result ? JSON.parse(j.result) : null;
  } catch {
    return null;
  }
}

async function finCacheSet(
  docId: string,
  value: Pick<EdinetFinancials, "sales" | "operating_income" | "net_income">,
): Promise<void> {
  const { url, token } = upstashEnv();
  if (!url || !token) return;
  try {
    await fetch(
      `${url}/set/edinet:fin:${encodeURIComponent(docId)}?EX=${WEEK_SECONDS}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(value),
        cache: "no-store",
      },
    );
  } catch {
    // best-effort cache; ignore
  }
}
