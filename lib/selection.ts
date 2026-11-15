import { conditionsFor, weeklyRows, type ConditionRow, type Records } from "@/lib/company-record";

/**
 * Selection: every condition this site has set, in one list. Weekly picks,
 * the article series (neocloud, physical AI) and the Japanese sector research
 * were separate pages (Selection / Catalysts / Themes); they are the same
 * thing — a company, a dated numeric condition, a verdict from the filing —
 * so here they are one list, and where a condition came from is a filter.
 */

import type { Group, SelectionRow } from "@/lib/selection-groups";
export { GROUPS, type Group, type SelectionRow } from "@/lib/selection-groups";

export function groupOf(population: string): Group {
  const p = population.toLowerCase();
  if (p.includes("weekly")) return "weekly";
  if (p.includes("neocloud")) return "neocloud";
  if (p.includes("physical")) return "physical-ai";
  return "jp-sectors";
}

const conditionText = (r: ConditionRow) => {
  const sc = r.success_conditions?.[0];
  return sc ? `${sc.metric} ${sc.operator} ${sc.threshold.value.toLocaleString("en-US")} ${sc.threshold.unit}` : r.question;
};

/** Every condition (superseded ones left out), newest deadline first. Pure over the records. */
export function selectionRows(rec: Records, today: string): SelectionRow[] {
  const tickers = new Set<string>();
  for (const r of [...weeklyRows("us", rec.usHistory, rec.usEvals), ...weeklyRows("jp", rec.jpHistory, rec.jpEvals)]) tickers.add(r.ticker);
  for (const c of rec.externals) tickers.add(String(c.ticker).toUpperCase());
  for (const c of rec.irFair?.catalysts ?? []) tickers.add(String(c.ticker).toUpperCase());

  const seen = new Set<string>();
  const out: SelectionRow[] = [];
  for (const t of tickers) {
    for (const r of conditionsFor(t, rec, today)) {
      if (r.status === "superseded" || seen.has(r.id) || !r.question && !r.success_conditions?.length) continue;
      seen.add(r.id);
      out.push({
        id: r.id,
        ticker: r.ticker,
        company: r.company ?? r.ticker,
        group: groupOf(r.population),
        condition: conditionText(r),
        target_date: r.target_date,
        result: r.result,
        status: r.status,
        evidence_url: r.evidence_url,
      });
    }
  }
  // The record first (judged, newest deadline first), then what is pending (nearest deadline first).
  const judged = out.filter((r) => r.status === "judged").sort((a, b) => b.target_date.localeCompare(a.target_date) || a.ticker.localeCompare(b.ticker));
  const open = out.filter((r) => r.status !== "judged").sort((a, b) => a.target_date.localeCompare(b.target_date) || a.ticker.localeCompare(b.ticker));
  return [...judged, ...open];
}
