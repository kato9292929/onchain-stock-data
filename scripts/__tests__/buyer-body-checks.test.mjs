/**
 * The buyer logs what a paid body contains as counts only — never the body.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyChecks } from "../x402-weekly-buyer.mjs";

test("a clean paid body: complete rows, sourced financials, no model dates or opaque ids", () => {
  const body = {
    ticker: "6920",
    next_earnings: { date: null, status: "not_announced", source_url: null, checked_at: "x" },
    financials: { latest: { revenue: { value: 1, source_url: "https://www.release.tdnet.info/inbs/a.pdf" }, net_income: { value: 2, source_url: null } } },
    conditions: [{ id: "jp-weekly-2026-10-05-6920", ticker: "6920", question: "q", target_date: "2026-10-30", result: "hit", evidence_url: "https://e", verdict_history: [{ id: "ext:old", result: "miss" }] }],
  };
  assert.deepEqual(bodyChecks(JSON.stringify(body)), {
    json: true,
    rows: 1,
    incomplete_rows: 0,
    model_dates: 0,
    opaque_ids: 1,
    note_keys: 0,
    financial_values: 2,
    financial_values_with_url: 1,
    next_earnings: "not_announced",
  });
});

test("the old shape is caught, and a non-JSON body reports only its size", () => {
  const old = { next_earnings: { target_date_source: "model" }, date_source_meaning: "…", latest_verdict: { id: "ext:ext_1", result: "miss" } };
  const c = bodyChecks(JSON.stringify(old));
  assert.equal(c.model_dates, 1);
  assert.equal(c.opaque_ids, 1);
  assert.equal(c.note_keys, 1);
  assert.equal(c.incomplete_rows, 1);
  assert.deepEqual(bodyChecks("<html>"), { json: false, bytes: 6 });
});
