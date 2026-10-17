/**
 * A condition dated too early must not be judged before the disclosure exists.
 *
 * The deadline is the selection model's own date, unchecked. Reconciling two
 * of the 2026-10-12 JP picks against their IR pages found both wrong: 8035
 * said 10-29 where the company published 10-30, and 6857 said 11-05 against a
 * published 10-28. Seven days of grace absorbed both. A condition dated eight
 * or more days early would not be absorbed: the scorer would look, find
 * nothing, and record a miss for a silence that never happened.
 *
 * The source is scanned rather than executed — the scorer bills on import of
 * its main path, and this is about one arithmetic rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("scripts/evaluate-catalysts.mjs", "utf8");
const GRACE_DAYS = 7;

/** Mirrors judgeableFrom in the scorer. */
const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const judgeableFrom = (target, confirmed) =>
  addDays(confirmed && confirmed > target ? confirmed : target, GRACE_DAYS);

test("a confirmed date 8 days later pushes judging past it", () => {
  // The case the grace window cannot absorb.
  const target = "2026-10-20";
  const confirmed = "2026-10-28";
  assert.equal(judgeableFrom(target, undefined), "2026-10-27", "unreconciled");
  assert.equal(judgeableFrom(target, confirmed), "2026-11-04");
  assert.ok(
    judgeableFrom(target, confirmed) > confirmed,
    "judging must start after the company has published",
  );
});

test("the two real reconciliations behave as expected", () => {
  // 8035: ours 10-29, published 10-30 — one day late, already absorbed.
  assert.equal(judgeableFrom("2026-10-29", "2026-10-30"), "2026-11-06");
  // 6857: ours 11-05, published 10-28 — earlier, so the condition's own
  // deadline still governs. A confirmed date is never allowed to pull judging
  // forward; that would shorten a window the condition was published with.
  assert.equal(judgeableFrom("2026-11-05", "2026-10-28"), "2026-11-12");
  assert.equal(judgeableFrom("2026-11-05", undefined), "2026-11-12");
});

test("no confirmed date leaves the old behaviour untouched", () => {
  for (const d of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
    assert.equal(judgeableFrom(d, undefined), addDays(d, GRACE_DAYS));
    assert.equal(judgeableFrom(d, null), addDays(d, GRACE_DAYS));
  }
});

test("the scorer actually uses this rule on both internal lanes", () => {
  assert.match(SRC, /const judgeableFrom = \(targetDate, key\) =>/);
  assert.match(
    SRC,
    /confirmed && confirmed > targetDate \? confirmed : targetDate/,
    "later of the two, never earlier",
  );
  assert.equal(
    (SRC.match(/judgeableFrom\(e\.catalyst_target_date, keyOf\(e\)\)/g) ?? []).length,
    2,
    "internal and jp lanes both gated",
  );
  // External submissions carry no portfolio week, so there is nothing to look up.
  assert.match(SRC, /External submissions have no portfolio week/);
});

test("target_date is never rewritten by the reconciliation", () => {
  // A condition is fixed when it is published; the company's date is recorded
  // beside it, not in place of it.
  assert.doesNotMatch(
    SRC,
    /catalyst_target_date = .*confirmed/,
    "the deadline must stay as published",
  );
  assert.match(SRC, /`target_date` itself is never moved/);
});
