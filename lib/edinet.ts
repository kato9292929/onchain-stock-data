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
  /** Diagnostic (only when financials_available is false): the biggest current
   * 連結 JPY rows, so the real revenue/income element IDs are visible in the
   * normal response — no debug query needed. */
  debug_unmatched?: UnmatchedRow[];
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
/**
 * Standard XBRL element local-names (after the ":") per metric, priority order.
 * The "主要な経営指標等 (SummaryOfBusinessResults)" elements are standardized by
 * accounting standard (JGAAP / IFRS / USGAAP), so they are the primary source;
 * the primary-statement elements are alternates. Matched by local name because
 * the namespace prefix drifts across taxonomy versions.
 *
 * NOTE: 経常利益 (OrdinaryIncome…) is deliberately NOT an operating-income
 * alternate — it is a different line, so substituting it would be fabrication.
 */
const ELEMENTS: Record<"sales" | "operating_income" | "net_income", string[]> = {
  sales: [
    "NetSalesSummaryOfBusinessResults", // JGAAP 売上高
    "RevenueIFRSSummaryOfBusinessResults", // IFRS 売上収益
    "OperatingRevenuesIFRSKeyFinancialData", // IFRS 営業収益 (finance-arm filers: Toyota/Sony)
    "RevenuesUSGAAPSummaryOfBusinessResults", // USGAAP
    "NetSales", // JGAAP primary-statement alternate (jppfs_cor)
    "RevenueIFRS", // IFRS primary-statement alternate (jpigp_cor)
  ],
  operating_income: [
    "OperatingProfitLossIFRSSummaryOfBusinessResults", // IFRS
    "OperatingIncomeLossUSGAAPSummaryOfBusinessResults", // USGAAP
    "OperatingIncome", // JGAAP primary-statement (jppfs_cor)
    "OperatingProfitLossIFRS", // IFRS primary-statement alternate (jpigp_cor)
    // JGAAP summary rarely carries 営業利益 → stays null (do NOT use 経常利益)
  ],
  net_income: [
    "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults", // JGAAP
    "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults", // IFRS
    "NetIncomeLossAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults", // USGAAP
    "ProfitLossAttributableToOwnersOfParent", // JGAAP primary-statement alternate
    "ProfitLossAttributableToOwnersOfParentIFRS", // IFRS primary-statement alternate
  ],
};

export interface CsvRow {
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

/** Decode an EDINET type=5 CSV file: UTF-16LE with a leading BOM. */
function decodeCsv(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf16le").replace(/^﻿/, "");
}

/**
 * RFC 4180-style parser, TAB delimiter. EDINET quotes the 「値」column (and
 * sometimes 項目名) with double-quotes, and a quoted field may contain RAW tabs
 * and RAW newlines — so a naive split('\t') / line-split shreds the table
 * ("columns not found"). This tracks quote state char-by-char instead.
 */
function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (ch === "\t") {
      row.push(field);
      field = "";
      fieldStart = true;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      fieldStart = true;
    } else if (ch === "\r") {
      // CRLF — ignore the CR
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse a decoded EDINET CSV into typed rows. Throws on a genuine structural
 * mismatch (9-column header 要素ID…値 not found) — fail loud on the paid path;
 * the debug endpoint catches it and returns diagnostics instead. Exported for
 * unit tests (synthetic UTF-16LE bytes → rows). */
export function parseCsv(bytes: Uint8Array): CsvRow[] {
  const table = parseTsv(decodeCsv(bytes));
  if (table.length < 2) throw new Error("EDINET CSV: no data rows");
  const header = table[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iEl = idx("要素ID");
  const iName = idx("項目名");
  const iCtx = idx("コンテキストID");
  const iRel = idx("相対年度");
  const iCon = idx("連結・個別");
  const iPer = idx("期間・時点");
  const iUnit = idx("単位");
  const iVal = idx("値");
  if (iEl < 0 || iVal < 0) {
    throw new Error(
      `EDINET CSV: header mismatch (要素ID/値 not found; cols=${header.length})`,
    );
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const c = table[i];
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

/**
 * True if the row's value is the CONSOLIDATED (連結) group figure.
 *
 * The 「連結・個別」CSV column is useless — EDINET fills it with "その他" for the
 * 主要な経営指標等 rows regardless of which table they belong to. The real
 * distinction lives in the CONTEXT ID: the consolidated group total sits on the
 * base period context (e.g. `CurrentYearDuration`), while the parent-only (単体)
 * figure is tagged `..._NonConsolidatedMember` and any segment / other breakdown
 * carries some other `..._…Member` axis. So: reject NonConsolidated, and reject
 * every dimensional Member context — what's left is the consolidated total.
 *
 * A 単体-only filer (no subsidiaries) has no NonConsolidatedMember rows at all;
 * its figures live on the base context too, so they still pass here.
 */
function isConsolidatedContext(ctx: string): boolean {
  if (/NonConsolidated/i.test(ctx)) return false;
  if (/Member/.test(ctx)) return false; // any dimensional member = a breakdown, not the group total
  return true;
}

/**
 * Pick a metric's value from parsed rows: current + JPY, trying each candidate
 * element in priority order. Prefers the CONSOLIDATED-context row (see
 * isConsolidatedContext); only if no candidate has a consolidated row does it
 * fall back to any context (covers 単体-only filers). Returns null if none match.
 */
function pickMetric(rows: CsvRow[], candidates: string[]): number | null {
  for (const name of candidates) {
    const hit = rows.find(
      (r) => r.element === name && isCurrentJpy(r) && isConsolidatedContext(r.contextId),
    );
    if (hit) return Number(hit.value);
  }
  for (const name of candidates) {
    const hit = rows.find((r) => r.element === name && isCurrentJpy(r));
    if (hit) return Number(hit.value);
  }
  return null;
}

/** Pure extraction of the three headline figures from parsed rows (consolidated
 * preferred via context). Exported so it can be unit-tested against synthetic
 * rows without touching the network. */
export function extractFromRows(rows: CsvRow[]): {
  sales: number | null;
  operating_income: number | null;
  net_income: number | null;
} {
  return {
    sales: pickMetric(rows, ELEMENTS.sales),
    operating_income: pickMetric(rows, ELEMENTS.operating_income),
    net_income: pickMetric(rows, ELEMENTS.net_income),
  };
}

/** Choose the report-body CSV(s) from a type=5 bundle: the 有報 body is the
 * `jpcrp…` file; audit reports (`jpaud…`) and manifests are excluded. */
function pickReportCsvNames(names: string[]): string[] {
  const base = (n: string) => (n.split("/").pop() ?? n).toLowerCase();
  const csvs = names.filter((n) => base(n).endsWith(".csv"));
  const jpcrp = csvs.filter((n) => base(n).startsWith("jpcrp"));
  if (jpcrp.length) return jpcrp;
  return csvs.filter((n) => !base(n).startsWith("jpaud")); // fallback: non-audit
}

/** Fetch + unzip a doc's type=5 bundle. Throws on fetch error / non-ZIP. */
async function fetchReportZip(docId: string): Promise<Record<string, Uint8Array>> {
  const url = `${BASE}/documents/${encodeURIComponent(docId)}?type=5&Subscription-Key=${encodeURIComponent(apiKey())}`;
  const res = await fetch(url, { next: { revalidate: WEEK_SECONDS } });
  if (!res.ok) throw new Error(`EDINET type=5 fetch failed (${res.status}) for ${docId}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { unzipSync } = await import("fflate");
  return unzipSync(buf); // throws if not a valid ZIP
}

/** Parsed rows of a report's main CSV(s). FAIL LOUD on a structural failure. */
async function fetchReportRows(docId: string): Promise<CsvRow[]> {
  const files = await fetchReportZip(docId);
  const names = pickReportCsvNames(Object.keys(files));
  const rows: CsvRow[] = [];
  for (const n of names) rows.push(...parseCsv(files[n]));
  if (rows.length === 0) {
    throw new Error(`EDINET type=5 bundle has no parseable rows for ${docId} (csvs=${names.length})`);
  }
  return rows;
}

export interface UnmatchedRow {
  element_id: string;
  item_name: string;
  context: string;
  consolidated: boolean;
  value: string;
}

/** The largest current-period JPY monetary rows, deduped by element, consolidated
 * first. Attached to the response when extraction fails so the real revenue/income
 * element IDs are visible (sales/opinc/net income are among the biggest figures)
 * without needing the debug query. Diagnostic only, never used as a value. */
function topMonetaryRows(rows: CsvRow[], limit: number): UnmatchedRow[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => isCurrentJpy(r))
    .sort((a, b) => {
      const con =
        (isConsolidatedContext(b.contextId) ? 1 : 0) -
        (isConsolidatedContext(a.contextId) ? 1 : 0);
      if (con !== 0) return con;
      return Math.abs(Number(b.value)) - Math.abs(Number(a.value));
    })
    .filter((r) => (seen.has(r.elementId) ? false : (seen.add(r.elementId), true)))
    .slice(0, limit)
    .map((r) => ({
      element_id: r.elementId,
      item_name: r.itemName,
      context: r.contextId,
      consolidated: isConsolidatedContext(r.contextId),
      value: r.value,
    }));
}

/** Extract the three headline figures from a report. Cached by docID in Upstash
 * ONLY on success (a null result is never cached, so a mapping fix takes effect
 * immediately). Fail-loud on structural errors; a clean parse with no matching
 * element returns nulls + a diagnostic `unmatched` sample. */
async function extractFinancials(docId: string): Promise<{
  sales: number | null;
  operating_income: number | null;
  net_income: number | null;
  unmatched: UnmatchedRow[];
}> {
  const cached = await finCacheGet(docId);
  if (cached) return { ...cached, unmatched: [] };
  const rows = await fetchReportRows(docId); // fail loud
  const values = extractFromRows(rows);
  const available =
    values.sales != null || values.operating_income != null || values.net_income != null;
  if (available) await finCacheSet(docId, values); // cache successes only
  return { ...values, unmatched: available ? [] : topMonetaryRows(rows, 40) };
}

/** Debug dump — the raw XBRL element rows of a company's latest report, so the
 * real element IDs for sales/operating income/net income can be confirmed from
 * fact instead of guessed. Current-period / 連結 / JPY rows are surfaced first.
 * Unprocessed; behind the same paywall as the main endpoint. */
export interface EdinetElementDump {
  doc: EdinetDoc | null;
  zip_entries?: string[];
  csv_read?: string[];
  encoding?: string;
  header_raw?: string;
  sample?: string;
  count: number;
  error?: string;
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

/** Debug dump — NEVER throws. Returns ZIP entry names, the CSV(s) read, the
 * encoding, the raw header + a sample, and (best-effort) the parsed rows with
 * current/連結/JPY surfaced first — so the real element IDs can be confirmed
 * from fact even if the structured parse fails. */
export async function dumpReportElements(
  ticker: string,
  windowDays: number = FINANCIAL_WINDOW_DAYS,
  limit = 600,
): Promise<EdinetElementDump> {
  const doc = await getLatestReport(ticker, windowDays);
  if (!doc) return { doc: null, count: 0, elements: [], error: "no report in window" };
  try {
    const files = await fetchReportZip(doc.doc_id);
    const zipEntries = Object.keys(files);
    const csvNames = pickReportCsvNames(zipEntries);
    const rawText = csvNames[0] ? decodeCsv(files[csvNames[0]]) : "";
    let rows: CsvRow[] = [];
    let parseError: string | undefined;
    try {
      for (const n of csvNames) rows.push(...parseCsv(files[n]));
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
    const score = (r: CsvRow) =>
      (r.relYear === "当期" ? 4 : 0) +
      (isConsolidatedContext(r.contextId) ? 2 : 0) +
      (r.unit.includes("円") || r.unit.toUpperCase().includes("JPY") ? 1 : 0);
    const sorted = [...rows].sort((a, b) => score(b) - score(a));
    return {
      doc,
      zip_entries: zipEntries,
      csv_read: csvNames,
      encoding: "utf-16le",
      header_raw: (rawText.split("\n")[0] ?? "").slice(0, 2000),
      sample: rawText.slice(0, 4000),
      count: rows.length,
      error: parseError,
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
  } catch (e) {
    return { doc, count: 0, elements: [], error: e instanceof Error ? e.message : String(e) };
  }
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
    debug_unmatched: available ? undefined : fin.unmatched,
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
    const res = await fetch(`${url}/get/edinet:fin:v2:${encodeURIComponent(docId)}`, {
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
      `${url}/set/edinet:fin:v2:${encodeURIComponent(docId)}?EX=${WEEK_SECONDS}`,
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
