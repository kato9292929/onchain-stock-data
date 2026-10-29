/**
 * One hit-rate formula, pinned.
 *
 * These boards drifted apart silently once already: the Physical-AI and
 * IR-Fair boards gave a `partial` half credit and dropped `na` from the
 * denominator, while the JP portfolio page counted `hit` alone against a
 * denominator that included `na`. The same JP record read 65% on one formula
 * and 38% on the other, and nothing failed — the divergence was only caught by
 * reading two pages side by side. So the formula is a test, not a convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { hitRateOf, judgedCount, tally, emptyCounts } = await import("../../lib/hit-rate.ts");

const counts = (o) => ({ ...emptyCounts(), ...o });

test("a partial is worth half a hit", () => {
  assert.equal(hitRateOf(counts({ hit: 1, miss: 1 })), 0.5);
  assert.equal(hitRateOf(counts({ partial: 2 })), 0.5, "two halves make one hit");
  assert.equal(hitRateOf(counts({ hit: 1, partial: 1 })), 0.75);
});

test("na stays in the denominator", () => {
  // The decision this module exists to hold. Dropping na would make this 1.0.
  assert.equal(hitRateOf(counts({ hit: 1, na: 1 })), 0.5);
  assert.equal(
    hitRateOf(counts({ hit: 3, partial: 1, miss: 1, na: 5 })),
    3.5 / 10,
    "an unjudgeable condition did not earn a hit",
  );
});

test("pending never counts, in either half of the fraction", () => {
  const c = counts({ hit: 1, pending: 99 });
  assert.equal(judgedCount(c), 1);
  assert.equal(hitRateOf(c), 1);
});

test("nothing judged yet is null, not zero", () => {
  // 0% would read as "scored and failed everything" on the page.
  assert.equal(hitRateOf(counts({ pending: 10 })), null);
  assert.equal(hitRateOf(emptyCounts()), null);
});

test("the live JP and Physical-AI records agree with the published numbers", async () => {
  const fs = await import("node:fs");
  const jp = JSON.parse(
    fs.readFileSync("data/jp-portfolio-evaluations.json", "utf8"),
  ).evaluations;
  const jpRate = hitRateOf(tally(jp.map((e) => e.status)));

  const pa = JSON.parse(fs.readFileSync("data/external-catalysts.json", "utf8"));
  const paList = Array.isArray(pa) ? pa : (pa.catalysts ?? []);
  const paCounts = tally(paList.map((c) => c.status));

  // Physical AI has no na rows, so this formula leaves its number untouched —
  // the switch cannot be mistaken for a convenient choice.
  assert.equal(paCounts.na, 0, "a na row here would mean re-checking the article");
  assert.ok(jpRate > 0.4 && jpRate < 0.6, `JP rate drifted: ${jpRate}`);
});

test("tally rejects nothing and counts everything", () => {
  const c = tally(["hit", "hit", "partial", "miss", "na", "pending"]);
  assert.deepEqual(c, { hit: 2, partial: 1, miss: 1, na: 1, pending: 1, excluded: 0 });
  assert.equal(judgedCount(c), 5, "pending excluded");
});

test("excluded stays out of the denominator, and is still counted", () => {
  // A pick withdrawn before its deadline was never judged by anyone. Putting
  // it in the denominator would score us on a prediction we did not make; but
  // dropping it from the record entirely would hide that it ever existed.
  const c = counts({ hit: 3, miss: 1, excluded: 6 });
  assert.equal(judgedCount(c), 4, "excluded is not judged");
  assert.equal(hitRateOf(c), 0.75, "and does not move the rate");
  assert.equal(c.excluded, 6, "but the count survives for display");
});

test("a population of nothing but excluded has no rate at all", () => {
  assert.equal(hitRateOf(counts({ excluded: 5 })), null);
  assert.equal(judgedCount(counts({ excluded: 5 })), 0);
});

test("the live JP record keeps 81 API-judged after 6967 was excluded", () => {
  // 6967's 2026-10-12 row went pending -> excluded, not pending -> na. Had it
  // become na the denominator would have grown to 82 on a row no evaluator
  // ever looked at. The API evaluator's 81 are frozen since the chat
  // operation (2026-10-28); verdicts judged in chat carry an `evaluator` and
  // are counted on top, never in place of them.
  const ev = JSON.parse(
    readFileSync("data/jp-portfolio-evaluations.json", "utf8"),
  ).evaluations;
  const c = tally(ev.map((e) => e.status));
  const api = tally(ev.filter((e) => !e.evaluator).map((e) => e.status));
  assert.equal(judgedCount(api), 81, `API-era judged drifted: ${JSON.stringify(api)}`);
  assert.equal(
    judgedCount(c),
    81 + ev.filter((e) => e.evaluator && e.status !== "pending" && e.status !== "excluded").length,
  );
  // 2026-10-12 and 2026-10-19: both picked 6967 before the screen reached
  // production, both withdrawn before their deadlines.
  assert.equal(c.excluded, 2);
  const row = ev.find((e) => e.ticker === "6967" && e.week_of === "2026-10-12");
  assert.equal(row.status, "excluded");
  assert.equal(row.exclusion_reason, "delisted");
  assert.equal(row.verdict_history[0].status, "pending");
});
