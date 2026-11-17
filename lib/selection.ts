import { conditionsFor, weeklyRows, type ConditionRow, type Records } from "@/lib/company-record";
import type { ThemeDef } from "@/lib/theme-members";
import { members as membersOf } from "@/lib/themes";

/**
 * Selection: every condition this site has set, kept in its categories —
 * the weekly picks, the neocloud and physical-AI series and the Japanese
 * sectors (formerly the Selection / Catalysts / Themes pages).
 */

import type { Group, SelectionRow } from "@/lib/selection-groups";
export { GROUPS, type Group, type SelectionRow } from "@/lib/selection-groups";

export function groupOf(population: string): Group {
  const p = population.toLowerCase();
  if (p.includes("us stocks")) return "us-stocks";
  if (p.includes("weekly")) return "weekly";
  if (p.includes("neocloud")) return "neocloud";
  if (p.includes("physical")) return "physical-ai";
  return "jp-sectors";
}

/** Wording as compared across editions: full/half-width, spacing and brackets folded; the 【外れ方向】 tail dropped. */
export function sameWording(q: string): string {
  return String(q ?? "")
    .split("【外れ方向】")[0]
    .normalize("NFKC")
    .replace(/[〜～]/g, "-")
    .replace(/[\s()（）「」、。,.・/\-]/g, "")
    .toLowerCase();
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
  // Weekly picks: the same stock picked several weeks running gets a fresh
  // condition each week, all judged on the same earnings. One stock × one
  // earnings is one prediction: keep the latest week's condition only.
  const weeklyBest = new Map<string, { row: SelectionRow; week: string }>();
  for (const t of tickers) {
    const all = conditionsFor(t, rec, today);
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const r of all) {
      if (r.status === "superseded" || seen.has(r.id) || !r.question && !r.success_conditions?.length) continue;
      // An older article edition whose condition the next edition carried over
      // unchanged (same deadline, same wording) is the same prediction: count it once.
      const next = r.superseded_by ? byId.get(r.superseded_by) : undefined;
      if (next && next.target_date === r.target_date && sameWording(next.question) === sameWording(r.question)) continue;
      seen.add(r.id);
      const row: SelectionRow = {
        id: r.id,
        ticker: r.ticker,
        company: r.company ?? r.ticker,
        group: groupOf(r.population),
        population: r.population,
        condition: conditionText(r),
        target_date: r.target_date,
        result: r.result,
        status: r.status,
        evidence_url: r.evidence_url,
      };
      if (r.week_of) {
        const k = `${r.population}|${r.ticker}|${r.target_date}`;
        const cur = weeklyBest.get(k);
        if (!cur || r.week_of > cur.week) weeklyBest.set(k, { row, week: r.week_of });
        continue;
      }
      out.push(row);
    }
  }
  for (const { row } of weeklyBest.values()) out.push(row);
  // The record first (judged, newest deadline first), then what is pending (nearest deadline first).
  const judged = out.filter((r) => r.status === "judged").sort((a, b) => b.target_date.localeCompare(a.target_date) || a.ticker.localeCompare(b.ticker));
  const open = out.filter((r) => r.status !== "judged").sort((a, b) => a.target_date.localeCompare(b.target_date) || a.ticker.localeCompare(b.ticker));
  return [...judged, ...open];
}

export interface SelectionSection {
  id: string;
  title: string;
  group: Group;
  companies: number;
  rows: SelectionRow[];
}

/**
 * The categories, in order: weekly picks, neocloud, physical AI, Japan sectors
 * (theme rank within each). A weekly section holds that market's weekly rows;
 * any other theme holds its members' non-weekly rows. A condition whose company
 * is in no theme goes to "Other". Pure over the records.
 */
export function selectionSections(rows: SelectionRow[], themes: ThemeDef[], rec: Records): SelectionSection[] {
  const order: Group[] = ["weekly", "neocloud", "physical-ai", "jp-sectors"];
  const groupOfTheme = (t: ThemeDef): Group =>
    t.kind === "weekly" ? "weekly" : t.id.startsWith("neocloud") ? "neocloud" : t.id.startsWith("physical-ai") ? "physical-ai" : "jp-sectors";
  const sorted = [...themes].sort((a, b) => order.indexOf(groupOfTheme(a)) - order.indexOf(groupOfTheme(b)) || a.rank - b.rank);

  const placed = new Set<string>();
  const sections: SelectionSection[] = [];
  for (const t of sorted) {
    const g = groupOfTheme(t);
    let mine: SelectionRow[];
    if (g === "weekly") {
      const want = t.market === "JP" ? "JP Weekly Selection" : "US Weekly Selection";
      mine = rows.filter((r) => r.population === want);
    } else {
      const tickers = new Set(membersOf(t, rec).map((m) => m.ticker.toUpperCase()));
      mine = rows.filter((r) => r.group !== "weekly" && r.group !== "us-stocks" && tickers.has(r.ticker.toUpperCase()));
    }
    for (const r of mine) placed.add(r.id);
    if (mine.length === 0) continue;
    sections.push({ id: t.id, title: t.title_en, group: g, companies: new Set(mine.map((r) => r.ticker)).size, rows: mine });
  }
  // The US stocks research is not a theme: one category of its own.
  const usStocks = rows.filter((r) => r.group === "us-stocks");
  if (usStocks.length) {
    for (const r of usStocks) placed.add(r.id);
    sections.push({ id: "us-stocks", title: "US stocks · next quarter", group: "us-stocks", companies: new Set(usStocks.map((r) => r.ticker)).size, rows: usStocks });
  }
  const rest = rows.filter((r) => !placed.has(r.id));
  if (rest.length) sections.push({ id: "other", title: "Other", group: "jp-sectors", companies: new Set(rest.map((r) => r.ticker)).size, rows: rest });
  return sections;
}
