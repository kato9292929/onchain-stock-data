/**
 * Did the model see outside data this week, or only its own weights?
 *
 * The flag was computed on every run and never written down — it lived on the
 * function's return value, not on the persisted entry — so for every week
 * already on record the answer is unrecoverable. That mattered once it turned
 * out the selection prompt carries no tools and no market data: the credit
 * spread claims in `rationale` are generated text, and nothing in the file
 * distinguished a week that had external context from one that had none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/jobs.ts", "utf8");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

test("JP records false structurally, not by accident", () => {
  // selectJpPortfolio has no externalContext parameter at all, so this cannot
  // become true by configuration — pin it to a literal rather than an expression.
  const jp = SRC.slice(SRC.indexOf("const portfolio: JpPortfolio = {"));
  assert.match(jp.slice(0, 600), /used_external_data: false/);
  assert.match(jp.slice(0, 600), /external_source: null/);
});

test("US records the real outcome of the fetch", () => {
  const us = SRC.slice(SRC.indexOf("const portfolio: Portfolio = {"));
  assert.match(
    us.slice(0, 600),
    /used_external_data: externalContext\.length > 0/,
    "true/false must follow whether the block was actually built",
  );
  assert.match(us.slice(0, 600), /external_source: externalSource/);
});

test("only the host is kept, never the URL", () => {
  // The endpoint is configuration; a data file that is committed and served
  // publicly is the wrong place for it.
  assert.match(SRC, /const externalSource = hostOf\(process\.env\.AA_EXTERNAL_DATA_URL\)/);
  assert.doesNotMatch(
    SRC,
    /external_source: process\.env\.AA_EXTERNAL_DATA_URL/,
    "the raw URL must never be persisted",
  );
  assert.match(SRC, /function hostOf/);
});

test("fetched_at is null when nothing was fetched", () => {
  assert.match(SRC, /externalData \? new Date\(\)\.toISOString\(\) : null/);
});

test("existing entries are left unfilled — absent is not false", () => {
  // Back-filling would invent a fact about weeks nobody recorded.
  for (const f of [
    "data/portfolio-history.json",
    "data/jp-portfolio-history.json",
  ]) {
    const h = read(f);
    const all = [...(h.current ? [h.current] : []), ...(h.history ?? [])];
    const old = all.filter((p) => p.week_of < "2026-10-16");
    assert.ok(old.length > 0, `${f}: no prior weeks to check`);
    assert.ok(
      old.every((p) => p.used_external_data === undefined),
      `${f}: a prior week was back-filled`,
    );
  }
});

test("every new pick records where its target_date came from", () => {
  // The date goes from the model's JSON through normalizeDate — a format check,
  // nothing more — straight into the file, and the prompt explicitly allows a
  // guess when no schedule is published. Nothing recorded which had happened.
  for (const f of ["lib/jp-portfolio.ts", "lib/portfolio.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(
      src,
      /target_date_source: "model"/,
      `${f}: an unchecked date must say so`,
    );
  }
});

test("normalizeDate is still only a format check — nothing silently fixes dates", () => {
  // If this ever starts reconciling, target_date_source must stop saying "model".
  const src = readFileSync("lib/jp-portfolio.ts", "utf8");
  const fn = src.slice(src.indexOf("function normalizeDate"));
  assert.match(fn.slice(0, 220), /test\(s\) \? s\.slice\(0, 10\) : ""/);
});

test("prior holdings are never back-filled as \"model\"", () => {
  // Those rows are "model" in fact, but nobody recorded it at the time, so
  // writing it in now would assert something the record never established.
  //
  // "verified" is a different matter: it is a new fact, created by going and
  // reading what the company published. Four of the 2026-10-12 picks carry it
  // for that reason, each with the IR page it was read from.
  const h = JSON.parse(readFileSync("data/jp-portfolio-history.json", "utf8"));
  const all = [...(h.current ? [h.current] : []), ...(h.history ?? [])];
  const old = all.filter((p) => p.week_of < "2026-10-17");
  assert.ok(old.length > 0);

  const holdings = old.flatMap((p) => p.holdings);
  assert.ok(
    holdings.every((x) => x.target_date_source !== "model"),
    "a prior holding was back-filled with an unrecorded claim",
  );
  for (const x of holdings.filter((h) => h.target_date_source === "verified")) {
    assert.ok(
      x.target_date_confirmed_source,
      `${x.ticker}: "verified" without the page it was read from`,
    );
    assert.ok(x.target_date_checked_at, `${x.ticker}: no check date`);
  }
});

test("a reconciliation never moves the deadline it checked", () => {
  // All four reconciled picks disagreed with the company. None was rewritten:
  // the condition is fixed when published, and the scorer waits for the later
  // of the two dates instead.
  const h = JSON.parse(readFileSync("data/jp-portfolio-history.json", "utf8"));
  const week = [...(h.current ? [h.current] : []), ...(h.history ?? [])].find(
    (p) => p.week_of === "2026-10-12",
  );
  assert.ok(week, "2026-10-12 must still be on record");
  const checked = week.holdings.filter((x) => x.target_date_source === "verified");
  assert.equal(checked.length, 4);
  assert.deepEqual(
    checked.map((x) => [x.ticker, x.target_date, x.target_date_confirmed]),
    [
      ["8035", "2026-10-29", "2026-10-30"],
      ["6857", "2026-11-05", "2026-10-28"],
      ["6146", "2026-10-29", "2026-10-22"],
      ["6504", "2026-11-06", "2026-10-29"],
    ],
    "all four disagreed, and all four kept their published deadline",
  );
});
