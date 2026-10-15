/**
 * The retroactive screen must not touch what was already scored.
 *
 * 6967 新光電気工業 delisted 2025-06-06 and was picked twice. The two weeks are
 * handled differently on purpose:
 *
 *   2026-06-22  already judged `na`. It stays `na`, stays in the 81-row
 *               population, and only gains `na_reason: "delisted"`. Rewriting
 *               a scored verdict to flatter the record is the one thing a
 *               track record cannot survive.
 *   2026-10-12  not yet judged. The pick is removed, the surviving nine are
 *               renormalised, and the removal is written down rather than
 *               quietly dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { excludeDelisted } = await import("../../lib/listing-status.ts");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

test("the already-scored week keeps its verdict", () => {
  const ev = read("data/jp-portfolio-evaluations.json").evaluations;
  const row = ev.find((e) => e.ticker === "6967" && e.week_of === "2026-06-22");
  assert.equal(row.status, "na", "a scored verdict is never rewritten");
  assert.equal(row.na_reason, "delisted", "but the cause is now on the record");
  assert.equal(row.verdict_history, undefined, "nothing was changed to annotate it");
});

test("the unscored week was excluded, with the removal written down", () => {
  const cur = read("data/jp-portfolio-history.json").current;
  assert.equal(cur.week_of, "2026-10-12");
  assert.ok(!cur.holdings.some((h) => h.ticker === "6967"), "the pick is gone");
  assert.equal(cur.holdings.length, 9);

  const [gone] = cur.excluded_holdings;
  assert.equal(gone.ticker, "6967");
  assert.equal(gone.original_weight, 9, "the weight it held is preserved");
  assert.match(gone.reason, /2025-06-06/, "and why");
});

test("the surviving book still sums to 100", () => {
  const cur = read("data/jp-portfolio-history.json").current;
  const sum = cur.holdings.reduce((n, h) => n + h.weight, 0);
  assert.equal(Math.round(sum * 10) / 10, 100);
});

test("its orphaned pending row became na, keeping the old value", () => {
  const ev = read("data/jp-portfolio-evaluations.json").evaluations;
  const row = ev.find((e) => e.ticker === "6967" && e.week_of === "2026-10-12");
  assert.equal(row.status, "na");
  assert.equal(row.verdict_history[0].status, "pending", "the prior value is kept");
  assert.equal(row.na_reason, "delisted");
});

test("the screen itself never rewrites a verdict — it only drops picks", () => {
  // Structural: excludeDelisted takes holdings, not evaluations, so it has no
  // way to reach a scored row. Pin that it returns the input untouched apart
  // from membership and weight.
  const snapshot = { as_of: "2026-09-30", listed: { 6146: { name: "", segment: "" } } };
  const holdings = [
    { ticker: "6146", weight: 50, thesis: "keep me", target_date: "2026-11-05" },
    { ticker: "6967", weight: 50, thesis: "drop me" },
  ];
  const { kept } = excludeDelisted(holdings, snapshot);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].thesis, "keep me", "fields other than weight are untouched");
  assert.equal(kept[0].target_date, "2026-11-05");
  assert.equal(holdings.length, 2, "the input array is not mutated");
  assert.equal(holdings[0].weight, 50, "nor the input objects");
});
