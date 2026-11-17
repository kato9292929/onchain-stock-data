#!/usr/bin/env node
/**
 * Judge the US stocks research conditions (series "stocks-us") from SEC EDGAR,
 * mechanically: each condition names one XBRL metric for one fiscal quarter
 * (scripts/import-from-chat.mjs stock_catalysts), so the verdict is the filed
 * number compared with the threshold. HIT or MISS, never PARTIAL; the evidence
 * is the filing itself. No model call, no paid API: EDGAR is free and public.
 *
 *   node --import tsx scripts/judge-stocks-edgar.mjs [--date YYYY-MM-DD] [--dry-run]
 *
 * A quarter not filed yet stays pending. One still missing 60 days after its
 * expected report date is marked na, with the reason.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { cikFor, filedQuarterValue, filingIndexUrl } = await import("../lib/edgar.ts");

const FILE = path.join(process.cwd(), "data", "external-catalysts.json");
const NA_AFTER_DAYS = 60;
const EVALUATOR = "edgar-xbrl (mechanical)";

const LABEL = { revenue: "Revenue", operating_income: "Operating income", net_income: "Net income", eps_diluted: "Diluted EPS" };

const cmp = (v, op, t) => (op === ">=" ? v >= t : op === ">" ? v > t : op === "<=" ? v <= t : v < t);
const fmt = (metric, v) => (metric === "eps_diluted" ? `${v} USD/share` : `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} USD mn`);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** The verdict for one row given the filed value (or its absence). Pure. */
export function verdictFor(row, filed, today, cik) {
  const a = row.auto_judge;
  if (filed) {
    const hit = cmp(filed.value, a.operator, a.threshold);
    const derived = filed.how === "derived" ? " (fiscal Q4 = full year less the nine months, both from the filings)" : "";
    return {
      status: hit ? "hit" : "miss",
      judgement_date: today,
      evidence_urls: [filingIndexUrl(cik, filed.accession)],
      reasoning:
        `${LABEL[a.metric]} for the quarter ending ${a.period_end}: ${fmt(a.metric, filed.value)}${derived}, ` +
        `${filed.form} filed ${filed.filed} (XBRL ${filed.tag}). Condition ${a.operator} ${fmt(a.metric, a.threshold)} → ${hit ? "HIT" : "MISS"}.`,
      evaluator: EVALUATOR,
    };
  }
  if (today > addDays(row.target_date, NA_AFTER_DAYS)) {
    return {
      status: "na",
      judgement_date: today,
      evidence_urls: [],
      reasoning: `No 10-Q / 10-K with ${LABEL[a.metric]} for the quarter ending ${a.period_end} on EDGAR ${NA_AFTER_DAYS} days after the expected report date (${row.target_date}).`,
      evaluator: EVALUATOR,
    };
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf("--date");
  const today = di >= 0 ? args[di + 1] : new Date().toISOString().slice(0, 10);
  const dry = args.includes("--dry-run");

  const list = JSON.parse(await readFile(FILE, "utf8"));
  const due = list.filter((c) => c.auto_judge && c.status === "pending" && c.auto_judge.period_end < today);
  let changed = 0;
  for (const row of due) {
    const hit = await cikFor(row.ticker);
    if (!hit) {
      console.log(`${row.ticker}: not an SEC filer, skipped`);
      continue;
    }
    const filed = await filedQuarterValue(hit.cik, row.auto_judge.metric, row.auto_judge.period_end);
    const v = verdictFor(row, filed, today, hit.cik);
    if (!v) {
      console.log(`${row.ticker}: quarter ending ${row.auto_judge.period_end} not filed yet`);
      continue;
    }
    Object.assign(row, v);
    changed += 1;
    console.log(`${row.ticker}: ${v.status.toUpperCase()} — ${v.reasoning}`);
  }
  console.log(`${due.length} due, ${changed} judged${dry ? " (dry run, nothing written)" : ""}`);
  if (changed && !dry) await writeFile(FILE, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
