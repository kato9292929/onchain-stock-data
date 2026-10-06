/**
 * The test that would have caught the three-month US outage.
 *
 * From 2026-07-08 the US scorer registered nothing, because it never read the
 * selection history the way JP does. Every test in this repo stayed green, and
 * the scorecard said `pending: 0` — which reads as "nothing waiting", not as
 * "nothing exists". The whole suite was asking whether the rows that exist
 * behave correctly; none of it asked whether the rows exist at all.
 *
 * So this file asks only that. Run it against the data as it stood in August
 * and the US side fails with nine uncovered weeks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { evaluationCoverage, US_AUTOREGISTER_FROM } = await import(
  "../../lib/evaluation-coverage.ts",
);

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const today = new Date().toISOString().slice(0, 10);

// Imported, not copied: the scorer, the scorecard endpoint and this check all
// read the same constant, so none of them can drift out from under the others.
const US_CUTOFF = US_AUTOREGISTER_FROM;

test("every US week since the cutoff reached the scorer", () => {
  const cov = evaluationCoverage(
    read("data/portfolio-history.json"),
    read("data/portfolio-evaluations.json").evaluations,
    { cutoff: US_CUTOFF, asOf: today },
  );
  assert.deepEqual(
    cov.gaps,
    [],
    `US selections never registered for scoring: ${JSON.stringify(cov.gaps)}`,
  );
});

test("every JP week reached the scorer", () => {
  // No cutoff: JP has self-registered from the start, so a gap anywhere is a
  // severed link, not a deliberate scope decision.
  const cov = evaluationCoverage(
    read("data/jp-portfolio-history.json"),
    read("data/jp-portfolio-evaluations.json").evaluations,
    { asOf: today },
  );
  assert.deepEqual(
    cov.gaps,
    [],
    `JP selections never registered for scoring: ${JSON.stringify(cov.gaps)}`,
  );
});

test("the US cutoff cannot be walked forward to silence the check", () => {
  // The cutoff is the one knob that makes gaps invisible. Push it past the
  // latest selection week and this file would pass by checking nothing at all
  // — the exact state it exists to detect. So require it to still be looking.
  const cov = evaluationCoverage(
    read("data/portfolio-history.json"),
    read("data/portfolio-evaluations.json").evaluations,
    { cutoff: US_CUTOFF, asOf: today },
  );
  assert.ok(
    cov.weeks.length > 0,
    `US_AUTOREGISTER_FROM (${US_CUTOFF}) now excludes every selected week — ` +
      "the coverage check is watching nothing.",
  );
});

test("a severed link is reported, a fresh week is not", () => {
  const history = {
    current: { week_of: "2026-10-05", holdings: [{ ticker: "JPM", target_date: "2026-10-14" }] },
    history: [
      { week_of: "2026-09-21", holdings: [{ ticker: "MSFT", target_date: "2026-10-27" }] },
      { week_of: "2026-09-14", holdings: [{ ticker: "NVDA", target_date: "2026-11-19" }] },
    ],
  };
  // Nothing registered at all — the shape of the real outage.
  const broken = evaluationCoverage(history, [], {
    cutoff: "2026-09-21",
    asOf: "2026-10-06",
  });
  assert.deepEqual(
    broken.gaps.map((g) => g.week_of),
    ["2026-09-21"],
    "09-14 is before the cutoff; 10-05 is inside the grace window",
  );
  assert.equal(broken.unregistered, 1);

  const fixed = evaluationCoverage(
    history,
    [{ week_of: "2026-09-21", ticker: "msft" }],
    { cutoff: "2026-09-21", asOf: "2026-10-06" },
  );
  assert.deepEqual(fixed.gaps, [], "ticker case must not matter");
});

test("the grace window covers the hour between the two crons", () => {
  // Selection commits 21:00 UTC Sunday, the scorer runs 22:00 the same night.
  // Between them the newest week is legitimately unregistered, and a single
  // missed scorer run leaves it that way for a week. Neither is a severed link.
  const history = {
    current: { week_of: "2026-10-05", holdings: [{ ticker: "JPM", target_date: "2026-10-14" }] },
  };
  const sameDay = evaluationCoverage(history, [], { asOf: "2026-10-05" });
  assert.deepEqual(sameDay.gaps, [], "selected an hour ago, not yet scored");

  const oneMissedRun = evaluationCoverage(history, [], { asOf: "2026-10-12" });
  assert.deepEqual(oneMissedRun.gaps, [], "one skipped run is not an outage");

  const stillMissing = evaluationCoverage(history, [], { asOf: "2026-10-13" });
  assert.equal(stillMissing.gaps.length, 1, "eight days with no row is");
});

test("holdings with no target date are never counted as gaps", () => {
  // The 49 US holdings before 2026-06-15 have no target_date. There is nothing
  // to judge them against, so they are out of scope permanently — not a link
  // waiting to be reconnected.
  const cov = evaluationCoverage(
    {
      history: [
        { week_of: "2026-06-01", holdings: [{ ticker: "AAPL" }, { ticker: "MSFT" }] },
      ],
    },
    [],
    { asOf: "2026-10-06" },
  );
  assert.deepEqual(cov.weeks, [], "a week with nothing judgeable is not checked");
});

test("the two copies of the cutoff have not drifted apart", () => {
  // The scorer runs under plain `node` and cannot import a .ts module — trying
  // to share this constant by import broke the weekly cron outright. So it is
  // duplicated, and the duplication is held together here instead: change one
  // copy without the other and this fails.
  const src = readFileSync("scripts/evaluate-catalysts.mjs", "utf8");
  const m = src.match(
    /US_AUTOREGISTER_FROM\s*=\s*process\.env\.US_AUTOREGISTER_FROM\s*\?\?\s*"([\d-]+)"/,
  );
  assert.ok(m, "could not find US_AUTOREGISTER_FROM in the scorer");
  assert.equal(
    m[1],
    US_AUTOREGISTER_FROM,
    "scripts/evaluate-catalysts.mjs and lib/evaluation-coverage.ts disagree " +
      "about which week US registration starts from",
  );
});
