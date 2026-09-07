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

/** 規約: 加工の明示。We filter by securities code and reshape fields; the
 * underlying filings are not altered. */
export const PROCESSED_BY =
  "onchain-stock-data — EDINET API v2 の documents.json(type=2) を証券コードで抽出し、" +
  "必要項目のみ再整形（原本の開示書類そのものは改変していない）。";

/** Weekly cache (seconds) for each date's document list. */
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** Default lookback window (calendar days) when scanning for a company's
 * recent filings. Kept small so a cold sweep is a bounded number of cached
 * date-list fetches shared across every ticker. */
export const DEFAULT_WINDOW_DAYS = 14;

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
