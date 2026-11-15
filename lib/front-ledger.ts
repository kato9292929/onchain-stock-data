import { conditionsFor, type ConditionRow, type Records } from "@/lib/company-record";
import { hitRateOf, tally, type ScoreCounts } from "@/lib/hit-rate";
import type { ThemeDef } from "@/lib/theme-members";
import { members as membersOf } from "@/lib/themes";

/** One condition as the front page shows it — the same fields for every company. */
export interface LedgerItem {
  id: string;
  ticker: string;
  company: string;
  /** What has to be disclosed for a hit: the checkable rule when there is one, else the question. */
  condition: string;
  target_date: string;
  result: ConditionRow["result"];
  status: ConditionRow["status"];
  evidence_url: string | null;
}

const toItem = (r: ConditionRow): LedgerItem => {
  const sc = r.success_conditions?.[0];
  return {
    id: r.id,
    ticker: r.ticker,
    company: r.company ?? r.ticker,
    condition: sc ? `${sc.metric} ${sc.operator} ${sc.threshold.value.toLocaleString("en-US")} ${sc.threshold.unit}` : r.question,
    target_date: r.target_date,
    result: r.result,
    status: r.status,
    evidence_url: r.evidence_url,
  };
};

/** One row per company, keeping the order; the checkable (structured) condition wins over prose. */
function onePerCompany(rows: ConditionRow[]): ConditionRow[] {
  const best = new Map<string, ConditionRow>();
  for (const r of rows) {
    const cur = best.get(r.ticker);
    if (!cur || (!cur.success_conditions?.length && r.success_conditions?.length)) best.set(r.ticker, r);
  }
  const out: ConditionRow[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    if (done.has(r.ticker)) continue;
    done.add(r.ticker);
    out.push(best.get(r.ticker)!);
  }
  return out;
}

/**
 * Everything the front page says about the record, from one source: every
 * company in the themes, every condition held on it (superseded ones left out).
 * Pure over the records.
 */
export function frontLedger(themes: ThemeDef[], rec: Records, today: string, nRecent = 3, nUpcoming = 6) {
  const tickers = new Set<string>();
  for (const t of themes) for (const m of membersOf(t, rec)) tickers.add(m.ticker.toUpperCase());

  const seen = new Set<string>();
  const rows: ConditionRow[] = [];
  for (const t of tickers) {
    for (const r of conditionsFor(t, rec, today)) {
      if (r.status === "superseded" || seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
  }

  const judged = rows.filter((r) => r.status === "judged");
  const counts: ScoreCounts = tally(judged.map((r) => r.result));
  const recent = onePerCompany(
    judged
      .filter((r) => r.result === "hit" || r.result === "partial" || r.result === "miss")
      .sort((a, b) => ((b.judged_at ?? b.target_date) < (a.judged_at ?? a.target_date) ? -1 : 1)),
  )
    .slice(0, nRecent)
    .map(toItem);
  const upcoming = onePerCompany(
    rows
      .filter((r) => r.status === "active")
      .sort((a, b) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : a.ticker < b.ticker ? -1 : 1)),
  )
    .slice(0, nUpcoming)
    .map(toItem);

  return {
    companies: tickers.size,
    active: rows.filter((r) => r.status === "active").length,
    judged: judged.length,
    counts,
    hit_rate: hitRateOf(counts),
    recent,
    upcoming,
  };
}
