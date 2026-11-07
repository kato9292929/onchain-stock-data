import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExternalCatalyst,
  JpPortfolioHistoryFile,
  PortfolioEvaluationsFile,
  PortfolioHistoryFile,
} from "@/lib/data";
import type { IrFairFile } from "@/lib/ir-fair-scoreboard";
import type { SignalsFile } from "@/lib/signals";
import type { ThemesFile } from "@/lib/themes";

/**
 * What this site holds on one company, in the shape every API response uses:
 * the conditions it set and how they were judged, the next earnings date read
 * off a primary source, and the latest disclosed financials extracted from the
 * filing. Pure functions over committed files — no fetch, no model, no price.
 *
 * Field meanings live in /docs (and the OpenAPI-style descriptor), not in the
 * responses: a response carries data only.
 */

// ── files ──────────────────────────────────────────────────────────────────

export type EarningsStatus = "confirmed" | "not_announced" | "unverified";

export interface NextEarnings {
  date: string | null;
  status: EarningsStatus;
  source_url: string | null;
  checked_at: string | null;
}

export interface EarningsDatesFile {
  checked_at: string;
  counts?: Record<EarningsStatus, number>;
  tickers: Record<string, NextEarnings & { market: "US" | "JP" }>;
}

export interface FinancialValue {
  value: number | null;
  unit: string;
  prior_value: number | null;
  yoy_pct: number | null;
  source_url: string | null;
  [k: string]: unknown;
}

export interface CompanyFinancials {
  market: "US" | "JP";
  company: string | null;
  source: string;
  fetched_at: string;
  [k: string]: unknown;
}

export interface FinancialsFile {
  updated_at: string;
  companies: Record<string, CompanyFinancials>;
}

async function readData<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", name), "utf8")) as T;
  } catch {
    return null;
  }
}

export const getEarningsDates = () => readData<EarningsDatesFile>("earnings-dates.json");
export const getFinancials = () => readData<FinancialsFile>("financials.json");

/** Everything a company record is built from. Any file may be missing. */
export interface Records {
  usHistory: PortfolioHistoryFile | null;
  usEvals: PortfolioEvaluationsFile | null;
  jpHistory?: JpPortfolioHistoryFile | null;
  jpEvals?: PortfolioEvaluationsFile | null;
  externals: ExternalCatalyst[];
  irFair?: IrFairFile | null;
  signals: SignalsFile | null;
  earnings?: EarningsDatesFile | null;
  financials?: FinancialsFile | null;
  themes?: ThemesFile | null;
}

// ── next earnings ─────────────────────────────────────────────────────────

/**
 * The next earnings date, only as a primary source states it. A ticker the
 * check did not reach is `unverified` with no date — never a guessed one.
 */
export function nextEarningsOf(ticker: string, rec: Pick<Records, "earnings">, today: string): NextEarnings {
  const e = rec.earnings?.tickers?.[ticker.toUpperCase()];
  if (!e) return { date: null, status: "unverified", source_url: null, checked_at: null };
  // A confirmed date that has since passed is no longer the next one.
  if (e.status === "confirmed" && e.date && e.date < today) {
    return { date: null, status: "unverified", source_url: null, checked_at: e.checked_at };
  }
  return { date: e.date, status: e.status, source_url: e.source_url, checked_at: e.checked_at };
}

/** Latest disclosed financials, as extracted from the filing; null if none. */
export function financialsOf(ticker: string, rec: Pick<Records, "financials">): CompanyFinancials | null {
  return rec.financials?.companies?.[ticker.toUpperCase()] ?? null;
}

// ── conditions ────────────────────────────────────────────────────────────

export type Result = "hit" | "partial" | "miss" | "na" | "pending" | "excluded";

/** One condition as every response shows it. */
export interface ConditionRow {
  /** Readable and stable, e.g. "us-weekly-2026-09-21-NVDA". */
  id: string;
  ticker: string;
  company: string | null;
  population: string;
  week_of: string | null;
  /** The condition being judged — what has to be disclosed for a hit. */
  question: string;
  fail_direction: string | null;
  /** The date the condition is judged on: the company's date when one was confirmed. */
  target_date: string;
  /** The IR page the date was read off, when it was. */
  target_date_source_url: string | null;
  result: Result;
  judged_at: string | null;
  evidence_url: string | null;
  /**
   * The condition in checkable form (metric / operator / threshold /
   * source_doc), where it was written that way; null for older rows.
   */
  success_conditions: StructuredCondition[] | null;
}

export interface StructuredCondition {
  metric: string;
  operator: ">" | ">=" | "<" | "<=";
  threshold: { value: number; unit: string };
  source_doc: string;
}

/** Paid rows add the reasoning and the full trail. */
export interface ConditionRowFull extends ConditionRow {
  evidence_urls: string[];
  reasoning: string | null;
  evaluator: string | null;
  verdict_history: unknown[];
}

export const POPULATION = {
  us: "US Weekly Selection",
  jp: "JP Weekly Selection",
  ext: "Physical AI series",
  submitted: "Submitted catalyst",
  irf: "JP Sector Research",
} as const;

/** Population label for a series-authored catalyst. */
const SERIES_LABEL: Record<string, string> = {
  "physical-ai": "Physical AI series",
  "neocloud-us": "Neocloud US",
  "neocloud-jp": "Neocloud Japan",
};
const seriesLabel = (series: string) => SERIES_LABEL[series] ?? `Theme: ${series}`;

const structured = (v: unknown): StructuredCondition[] | null =>
  Array.isArray(v) && v.length > 0 ? (v as StructuredCondition[]) : null;

const MARKER = "【外れ方向】";
function split(text: string): { success: string; fail: string | null } {
  const i = text.indexOf(MARKER);
  return i < 0
    ? { success: text.trim(), fail: null }
    : { success: text.slice(0, i).trim(), fail: text.slice(i + MARKER.length).trim() || null };
}

type Loose = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const RESULTS = new Set<Result>(["hit", "partial", "miss", "na", "pending", "excluded"]);
const result = (s: unknown): Result => (RESULTS.has(s as Result) ? (s as Result) : "pending");

/** Public id for a Physical-AI / submitted catalyst: no opaque `ext_` prefix. */
export function catalystPublicId(catalystId: string, series: string | null | undefined): string {
  const bare = catalystId.replace(/^ext[_:-]?/i, "");
  return series ? `${series}-${bare}` : `submitted-${bare}`;
}

function weeks<T extends { week_of: string; holdings: unknown[] }>(
  h: { current: T | null; history: T[] } | null | undefined,
): T[] {
  return [...(h?.current ? [h.current] : []), ...(h?.history ?? [])];
}

type Kind = "us" | "jp";
type HistoryLike = { current: unknown; history: unknown[] } | null | undefined;

/** Every row of one Weekly population (US / JP), joined to its holding. */
export function weeklyRows(
  kind: Kind,
  history: HistoryLike,
  evals: PortfolioEvaluationsFile | null | undefined,
  only?: string,
): ConditionRowFull[] {
  const holdings = new Map<string, Loose>();
  for (const p of weeks(history as { current: never; history: never[] } | null)) {
    const w = p as unknown as { week_of: string; holdings: Loose[] };
    for (const h of w.holdings ?? []) {
      const t = String(h.ticker).toUpperCase();
      if (only && t !== only) continue;
      const k = `${w.week_of}::${t}`;
      if (!holdings.has(k)) holdings.set(k, h);
    }
  }
  const rows: ConditionRowFull[] = [];
  for (const e of evals?.evaluations ?? []) {
    const t = String(e.ticker).toUpperCase();
    if (only && t !== only) continue;
    const h = holdings.get(`${e.week_of}::${t}`) ?? {};
    const x = e as unknown as Loose;
    const { success, fail } = split(e.success_condition ?? "");
    const verified = h.target_date_source === "verified";
    rows.push({
      id: `${kind}-weekly-${e.week_of}-${t}`,
      ticker: t,
      company: str(h.company_name),
      population: POPULATION[kind],
      week_of: e.week_of,
      question: success,
      fail_direction: fail,
      target_date: (verified && str(h.target_date_confirmed)) || e.catalyst_target_date,
      target_date_source_url: verified ? str(h.target_date_confirmed_source) : null,
      result: result(e.status),
      judged_at: e.evaluated_at ? String(e.evaluated_at).slice(0, 10) : null,
      evidence_url: e.evidence_url ?? null,
      success_conditions: structured(x.success_conditions) ?? structured(h.success_conditions),
      evidence_urls: e.evidence_url ? [e.evidence_url] : [],
      reasoning: e.reasoning,
      evaluator: str(x.evaluator),
      verdict_history: Array.isArray(x.verdict_history) ? (x.verdict_history as unknown[]) : [],
    });
  }
  return rows;
}

/** A Physical-AI series or submitted catalyst as a row. */
export function externalRow(c: ExternalCatalyst): ConditionRowFull {
  const x = c as unknown as Loose;
  const { success, fail } = split(c.catalyst_description ?? "");
  const urls = c.evidence_urls ?? [];
  return {
    id: catalystPublicId(c.catalyst_id, c.series),
    ticker: String(c.ticker).toUpperCase(),
    company: c.company_name ?? null,
    population: c.series ? seriesLabel(c.series) : POPULATION.submitted,
    week_of: null,
    question: success,
    fail_direction: fail,
    target_date: c.target_date,
    target_date_source_url: null,
    result: result(c.status),
    judged_at: c.judgement_date ?? null,
    evidence_url: urls[0] ?? null,
    success_conditions: structured(x.success_conditions),
    evidence_urls: urls,
    reasoning: c.reasoning,
    evaluator: str(x.evaluator),
    verdict_history: Array.isArray(x.verdict_history) ? (x.verdict_history as unknown[]) : [],
  };
}

/** Every condition this site holds on `ticker`, newest deadline first. */
export function conditionsFor(ticker: string, rec: Records): ConditionRowFull[] {
  const want = ticker.toUpperCase();
  const rows: ConditionRowFull[] = [
    ...weeklyRows("us", rec.usHistory, rec.usEvals, want),
    ...weeklyRows("jp", rec.jpHistory, rec.jpEvals, want),
    ...rec.externals.filter((c) => String(c.ticker).toUpperCase() === want).map(externalRow),
  ];

  for (const c of rec.irFair?.catalysts ?? []) {
    // Only researched (`active`) rows are conditions; drafts carry none.
    if (c.stage !== "active" || String(c.ticker).toUpperCase() !== want || !c.due_date) continue;
    const x = c as unknown as Loose;
    const urls = Array.isArray(x.evidence_urls)
      ? (x.evidence_urls as string[])
      : str(x.evidence_url)
        ? [x.evidence_url as string]
        : [];
    rows.push({
      id: `jp-sector-${want}`,
      ticker: want,
      company: c.company_name ?? null,
      population: POPULATION.irf,
      week_of: null,
      question: String(c.success_condition ?? "").trim(),
      fail_direction: c.fail_condition ? String(c.fail_condition).trim() : null,
      target_date: c.due_date,
      target_date_source_url: null,
      result: result(c.status),
      judged_at: str(x.judgement_date) ?? (str(x.evaluated_at)?.slice(0, 10) ?? null),
      evidence_url: urls[0] ?? null,
      success_conditions: structured(x.success_conditions),
      evidence_urls: urls,
      reasoning: str(x.reasoning),
      evaluator: str(x.evaluator),
      verdict_history: Array.isArray(x.verdict_history) ? (x.verdict_history as unknown[]) : [],
    });
  }

  return rows.sort((a, b) => (a.target_date < b.target_date ? 1 : a.target_date > b.target_date ? -1 : 0));
}

/** The free subset of a row: no reasoning, no history. */
export function freeRow(r: ConditionRowFull): ConditionRow {
  return {
    id: r.id,
    ticker: r.ticker,
    company: r.company,
    population: r.population,
    week_of: r.week_of,
    question: r.question,
    fail_direction: r.fail_direction,
    target_date: r.target_date,
    target_date_source_url: r.target_date_source_url,
    result: r.result,
    judged_at: r.judged_at,
    evidence_url: r.evidence_url,
    success_conditions: r.success_conditions,
  };
}

const JUDGED = new Set<Result>(["hit", "partial", "miss", "na"]);

/** Most recent verdict, by the date it was given, as a full free row. */
export function latestVerdict(rows: readonly ConditionRowFull[]): ConditionRow | null {
  const judged = rows.filter((r) => JUDGED.has(r.result));
  judged.sort((a, b) => ((a.judged_at ?? "") < (b.judged_at ?? "") ? 1 : -1));
  return judged[0] ? freeRow(judged[0]) : null;
}

export function resultCounts(rows: readonly ConditionRowFull[]): Record<Result, number> {
  const out: Record<Result, number> = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0, excluded: 0 };
  for (const r of rows) out[r.result] += 1;
  return out;
}

/** Signals that name the ticker. Unverified ones are flagged, not hidden. */
export function signalsFor(ticker: string, rec: Pick<Records, "signals">) {
  const want = ticker.toUpperCase();
  return (rec.signals?.signals ?? [])
    .filter((s) => (s.tickers ?? []).map((t) => t.toUpperCase()).includes(want))
    .map((s) => {
      const x = s as unknown as Loose;
      return {
        id: s.id,
        ticker: want,
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
