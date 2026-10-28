import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EvaluationStatus,
  ExternalCatalyst,
  PortfolioEvaluationsFile,
  PortfolioHistoryFile,
} from "@/lib/data";
import type { SignalsFile } from "@/lib/signals";

/**
 * Tokenized stocks on Solana (xStocks, Ondo Global Markets), joined to what
 * this site already records about the underlying company: the dated
 * conditions, their verdicts, and the next dated deadline.
 *
 * The token list is data/solana-stocks.json (scripts/refresh-solana-stocks.mjs,
 * weekly, issuers' own pages). Everything else is read from the files the
 * scorecards already use — nothing here fetches, prices or calls a model.
 */

export interface SolanaToken {
  ticker: string;
  symbol: string;
  name: string;
  issuer: string;
  asset_type: string | null;
  solana_mint: string;
  source_url: string;
  fetched_at: string;
}

export interface SolanaStocksFile {
  source: string;
  note: string;
  updated_at: string;
  sources: Record<
    string,
    { issuer: string; url: string | null; fetched_at: string | null; ok: boolean; count: number; last_error?: string }
  >;
  tokens: SolanaToken[];
}

export async function getSolanaStocks(): Promise<SolanaStocksFile> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "solana-stocks.json"),
    "utf8",
  );
  return JSON.parse(raw) as SolanaStocksFile;
}

/**
 * What a date means. Repeated in the free response, the 402 description and
 * the discovery descriptor, because a buyer deciding whether to pay needs it
 * before paying.
 */
export const DATE_SOURCE_MEANING =
  "target_date_source 'verified' = the date was read off the company's own IR / investor page " +
  "(target_date_confirmed_source is that page, target_date_checked_at when it was read); " +
  "'model' = the date the selection model wrote with the condition, not checked against the company; " +
  "'article' = the date an editorial series article assigned (date_confidence says estimated or confirmed). " +
  "A condition's own target_date is never moved; when the company's date differs it is recorded beside it " +
  "as target_date_confirmed, and judging waits for the later of the two plus 7 days.";

export type DateSource = "verified" | "model" | "article";

export interface ConditionRow {
  id: string;
  population: string;
  week_of: string | null;
  success_condition: string;
  fail_direction: string | null;
  target_date: string;
  target_date_source: DateSource;
  target_date_confirmed: string | null;
  target_date_confirmed_source: string | null;
  target_date_checked_at: string | null;
  status: EvaluationStatus;
  judged_at: string | null;
  evaluator: string | null;
  evidence_urls: string[];
  reasoning: string | null;
  verdict_history: unknown[];
}

export interface NextEarnings {
  date: string;
  target_date_source: DateSource;
  /** The IR page, for a verified date. */
  source_url: string | null;
  checked_at: string | null;
  /** Which condition the date comes from. */
  condition_id: string;
}

export interface Records {
  usHistory: PortfolioHistoryFile | null;
  usEvals: PortfolioEvaluationsFile | null;
  externals: ExternalCatalyst[];
  signals: SignalsFile | null;
}

const MARKER = "【外れ方向】";
function split(text: string): { success: string; fail: string | null } {
  const i = text.indexOf(MARKER);
  return i < 0
    ? { success: text.trim(), fail: null }
    : { success: text.slice(0, i).trim(), fail: text.slice(i + MARKER.length).trim() || null };
}

type Loose = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Every dated condition this site holds on `ticker` (US book + Physical AI). */
export function conditionsFor(ticker: string, rec: Records): ConditionRow[] {
  const want = ticker.toUpperCase();
  const rows: ConditionRow[] = [];

  const holdings = new Map<string, Loose>();
  for (const p of [rec.usHistory?.current, ...(rec.usHistory?.history ?? [])]) {
    if (!p) continue;
    for (const h of p.holdings ?? []) {
      if (String(h.ticker).toUpperCase() !== want) continue;
      const k = `${p.week_of}::${want}`;
      if (!holdings.has(k)) holdings.set(k, h as unknown as Loose);
    }
  }
  for (const e of rec.usEvals?.evaluations ?? []) {
    if (String(e.ticker).toUpperCase() !== want) continue;
    const h = holdings.get(`${e.week_of}::${want}`) ?? {};
    const x = e as unknown as Loose;
    const { success, fail } = split(e.success_condition ?? "");
    rows.push({
      id: `us:${e.week_of}:${want}`,
      population: "US Weekly Selection",
      week_of: e.week_of,
      success_condition: success,
      fail_direction: fail,
      target_date: e.catalyst_target_date,
      target_date_source: h.target_date_source === "verified" ? "verified" : "model",
      target_date_confirmed: str(h.target_date_confirmed),
      target_date_confirmed_source: str(h.target_date_confirmed_source),
      target_date_checked_at: str(h.target_date_checked_at),
      status: e.status,
      judged_at: e.evaluated_at ? String(e.evaluated_at).slice(0, 10) : null,
      evaluator: str(x.evaluator),
      evidence_urls: e.evidence_url ? [e.evidence_url] : [],
      reasoning: e.reasoning,
      verdict_history: Array.isArray(x.verdict_history) ? (x.verdict_history as unknown[]) : [],
    });
  }

  for (const c of rec.externals) {
    if (String(c.ticker).toUpperCase() !== want) continue;
    const x = c as unknown as Loose;
    const { success, fail } = split(c.catalyst_description ?? "");
    rows.push({
      id: `ext:${c.catalyst_id}`,
      population: c.series ? `Physical AI（${c.series}）` : "External catalyst",
      week_of: null,
      success_condition: success,
      fail_direction: fail,
      target_date: c.target_date,
      target_date_source: "article",
      target_date_confirmed: null,
      target_date_confirmed_source: null,
      target_date_checked_at: null,
      status: c.status,
      judged_at: c.judgement_date ?? null,
      evaluator: str(x.evaluator),
      evidence_urls: c.evidence_urls ?? [],
      reasoning: c.reasoning,
      verdict_history: Array.isArray(x.verdict_history) ? (x.verdict_history as unknown[]) : [],
    });
  }

  return rows.sort((a, b) => (a.target_date < b.target_date ? 1 : a.target_date > b.target_date ? -1 : 0));
}

/**
 * The next dated deadline on or after `today`, from the conditions.
 *
 * Our only dates are the ones attached to conditions — almost all are earnings
 * releases, which is why this is called next_earnings, but it is the next
 * deadline we hold, not an earnings calendar. A company date read off the IR
 * page wins over the model's guess for the same condition, and an earlier
 * date wins over a later one; on a tie, verified beats model beats article.
 */
export function nextEarnings(rows: readonly ConditionRow[], today: string): NextEarnings | null {
  const rank: Record<DateSource, number> = { verified: 0, model: 1, article: 2 };
  const cands: NextEarnings[] = [];
  for (const r of rows) {
    const date = r.target_date_confirmed ?? r.target_date;
    if (!date || date < today) continue;
    cands.push({
      date,
      target_date_source: r.target_date_source,
      source_url: r.target_date_source === "verified" ? r.target_date_confirmed_source : null,
      checked_at: r.target_date_source === "verified" ? r.target_date_checked_at : null,
      condition_id: r.id,
    });
  }
  cands.sort((a, b) =>
    a.date === b.date ? rank[a.target_date_source] - rank[b.target_date_source] : a.date < b.date ? -1 : 1,
  );
  return cands[0] ?? null;
}

const JUDGED = new Set(["hit", "partial", "miss", "na"]);

/** Most recent verdict, by the date it was given. */
export function latestVerdict(rows: readonly ConditionRow[]) {
  const judged = rows.filter((r) => JUDGED.has(r.status));
  judged.sort((a, b) => ((a.judged_at ?? "") < (b.judged_at ?? "") ? 1 : -1));
  const r = judged[0];
  return r ? { id: r.id, status: r.status, judged_at: r.judged_at } : null;
}

/** Signals that name the ticker. Unverified ones are flagged, not hidden. */
export function signalsFor(ticker: string, rec: Records) {
  const want = ticker.toUpperCase();
  return (rec.signals?.signals ?? [])
    .filter((s) => (s.tickers ?? []).map((t) => t.toUpperCase()).includes(want))
    .map((s) => {
      const x = s as unknown as Loose;
      return {
        id: s.id,
        claim: s.claim,
        direction: s.direction,
        source: s.source,
        source_url: str(x.source_url),
        source_tier: s.source_tier,
        verified: s.verified,
        observed_at: str(x.observed_at),
        added_at: s.added_at ?? null,
      };
    });
}

export interface TickerSummary {
  ticker: string;
  name: string;
  tokens: Array<Pick<SolanaToken, "issuer" | "symbol" | "solana_mint" | "asset_type" | "source_url" | "fetched_at">>;
  next_earnings: NextEarnings | null;
  conditions: number;
  latest_verdict: ReturnType<typeof latestVerdict>;
}

/** One row per underlying ticker, for the page and the free response. */
export function summarize(file: SolanaStocksFile, rec: Records, today: string): TickerSummary[] {
  const byTicker = new Map<string, SolanaToken[]>();
  for (const t of file.tokens) {
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }
  const out: TickerSummary[] = [];
  for (const [ticker, tokens] of byTicker) {
    const rows = conditionsFor(ticker, rec);
    out.push({
      ticker,
      name: tokens[0].name,
      tokens: tokens.map(({ issuer, symbol, solana_mint, asset_type, source_url, fetched_at }) => ({
        issuer,
        symbol,
        solana_mint,
        asset_type,
        source_url,
        fetched_at,
      })),
      next_earnings: nextEarnings(rows, today),
      conditions: rows.length,
      latest_verdict: latestVerdict(rows),
    });
  }
  return out;
}

// ── /api/solana-stocks/{ticker} ───────────────────────────────────────────
// The response bodies and the who-pays decision live here, not in the route,
// so they can be tested without importing the x402 wrapper (which builds a
// paywall at module scope).

/** Shown in the 402 challenge and in /.well-known/x402.json. */
export const PAID_DESCRIPTION =
  "Tokenized stock on Solana (xStocks / Ondo Global Markets) — full record for the underlying: every dated " +
  "condition this site has set on it with its verdict, verdict_history (earlier verdicts, never overwritten) " +
  "and evidence URLs, plus recent signals naming the ticker. Only tickers with at least one condition are " +
  "charged; one without returns the free view (mint, issuer, next deadline) at no cost, and an unknown " +
  "ticker returns 404. " +
  DATE_SOURCE_MEANING;

export type SolanaStockAccess = "not-found" | "free-only" | "paid";

export function classifySolanaStockAccess(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
): SolanaStockAccess {
  const want = ticker.toUpperCase();
  if (!file.tokens.some((t) => t.ticker === want)) return "not-found";
  return conditionsFor(want, rec).length > 0 ? "paid" : "free-only";
}

export function freeBody(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
  today: string,
  baseUrl: string,
) {
  const want = ticker.toUpperCase();
  const tokens = file.tokens.filter((t) => t.ticker === want);
  if (tokens.length === 0) return null;
  const rows = conditionsFor(want, rec);
  return {
    ticker: want,
    name: tokens[0].name,
    tokens: tokens.map(({ issuer, symbol, solana_mint, asset_type, source_url, fetched_at }) => ({
      issuer,
      symbol,
      solana_mint,
      asset_type,
      source_url,
      fetched_at,
    })),
    next_earnings: nextEarnings(rows, today),
    date_source_meaning: DATE_SOURCE_MEANING,
    condition_count: rows.length,
    latest_verdict: latestVerdict(rows),
    full:
      rows.length > 0
        ? {
            url: `${baseUrl}/api/solana-stocks/${encodeURIComponent(want)}?view=full`,
            price: "0.001 USDC per call (Solana, x402 exact)",
            contains: "conditions with verdicts, verdict_history and evidence URLs; recent signals",
          }
        : null,
    token_list_updated_at: file.updated_at,
  };
}

export function fullBody(
  ticker: string,
  file: SolanaStocksFile,
  rec: Records,
  today: string,
  baseUrl: string,
) {
  const free = freeBody(ticker, file, rec, today, baseUrl);
  if (!free) return null;
  return {
    ...free,
    full: undefined,
    conditions: conditionsFor(ticker, rec),
    signals: signalsFor(ticker, rec),
  };
}
