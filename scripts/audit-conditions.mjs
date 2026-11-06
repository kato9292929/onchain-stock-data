#!/usr/bin/env node
/**
 * List the conditions already on record that would not pass today's
 * import:chat selection rules. Read-only: nothing on record is rewritten
 * (a published condition is fixed), and the hit-rate is computed exactly as
 * before. Output: ops/condition-audit.md.
 *
 *   npm run audit:conditions
 *
 * Classes:
 *   A  vague wording (好材料・上振れ・堅調・改善 …) and no numeric threshold
 *   B  no numeric threshold at all (no vague word either)
 *   C  has a number in the text, but no structured metric / operator /
 *      threshold / source_doc (every row before 2026-11-05 is at least this)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectRows, hasNumericThreshold, vagueWithoutNumber } from "./lib/chat-ops.mjs";

const ROOT = process.cwd();
const FILES = {
  usEvals: "data/portfolio-evaluations.json",
  usHistory: "data/portfolio-history.json",
  jpEvals: "data/jp-portfolio-evaluations.json",
  jpHistory: "data/jp-portfolio-history.json",
  externals: "data/external-catalysts.json",
  irFair: "data/ir-fair-2026-catalysts.json",
};

/** Row → "A" | "B" | "C" | null (conforms). Pure. */
export function auditClass(row) {
  const structured = Array.isArray(row.ref?.success_conditions) && row.ref.success_conditions.length > 0;
  const text = row.success_condition ?? "";
  if (vagueWithoutNumber(text).length) return "A";
  if (!hasNumericThreshold(text)) return "B";
  return structured ? null : "C";
}

async function main() {
  const files = {};
  for (const [k, rel] of Object.entries(FILES)) {
    files[k] = JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
  }
  const rows = collectRows(files);
  const by = { A: [], B: [], C: [] };
  let ok = 0;
  for (const r of rows) {
    const c = auditClass(r);
    if (c) by[c].push(r);
    else ok += 1;
  }
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const table = (list) =>
    [
      "| id | ticker | 期日 | 判定 | 条件 |",
      "| --- | --- | --- | --- | --- |",
      ...list.map(
        (r) =>
          `| \`${r.id}\` | ${r.ticker} | ${r.target_date ?? ""} | ${r.status} | ${esc(r.success_condition)} |`,
      ),
    ].join("\n");
  const vague = (r) => vagueWithoutNumber(r.success_condition).join("・");
  const md = `# 既存の条件の点検（${new Date().toISOString().slice(0, 10)}）

\`npm run audit:conditions\` が書き出す。import:chat の選定に 2026-11-05 から課した基準
（各条件に metric・operator・threshold（数値と単位）・source_doc。曖昧語だけで数値の閾値がないものは不可）
に、記録済みの条件を照らした一覧。**既存の条件は書き換えない**（公表時点で固定）。的中率の集計方法も変えない。

| 区分 | 件数 | 内容 |
| --- | ---: | --- |
| A | ${by.A.length} | 曖昧語（${"好材料・上振れ・堅調・改善 など"}）があり、数値の閾値がない |
| B | ${by.B.length} | 曖昧語はないが、数値の閾値がない |
| C | ${by.C.length} | 数値はあるが、metric / operator / threshold / source_doc の構造がない |
| 適合 | ${ok} | |
| 計 | ${rows.length} | |

## A. 曖昧語あり・数値の閾値なし（${by.A.length}件）

| id | ticker | 期日 | 判定 | 曖昧語 | 条件 |
| --- | --- | --- | --- | --- | --- |
${by.A.map((r) => `| \`${r.id}\` | ${r.ticker} | ${r.target_date ?? ""} | ${r.status} | ${vague(r)} | ${esc(r.success_condition)} |`).join("\n")}

## B. 数値の閾値なし（${by.B.length}件）

${table(by.B)}

## C. 構造なし（${by.C.length}件）

${table(by.C)}
`;
  await writeFile(path.join(ROOT, "ops", "condition-audit.md"), md, "utf8");
  console.log(`[audit] ${rows.length} rows: A ${by.A.length} · B ${by.B.length} · C ${by.C.length} · ok ${ok}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
