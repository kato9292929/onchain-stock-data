import { test } from "node:test";
import assert from "node:assert/strict";

const { secTicker, seriesFromConcept, dropStale, filingsFromSubmissions } = await import("../../lib/edgar.ts");

const f = (start, end, val, filed, form = "10-Q", accn = "0000000000-26-000001") => ({ start, end, val, filed, form, accn });

test("edgar: share classes map to SEC's dash form", () => {
  assert.equal(secTicker("BRK.B"), "BRK-B");
  assert.equal(secTicker(" nvda "), "NVDA");
});

test("edgar: quarterly / annual / instant split, newest first, a restatement replaces the original", () => {
  const units = {
    USD: [
      f("2026-04-01", "2026-06-30", 100, "2026-08-01"),
      f("2026-04-01", "2026-06-30", 105, "2027-02-01", "10-K"), // restated in the next 10-K
      f("2026-07-01", "2026-09-30", 120, "2026-11-01"),
      f("2025-10-01", "2026-09-30", 400, "2026-11-20", "10-K"),
      f(undefined, "2026-09-30", 50, "2026-11-01"),
      f("2026-07-01", "2026-09-30", 999, "2026-11-01", "8-K"), // not a periodic report: ignored
    ],
  };
  const s = seriesFromConcept(units, "USD", "us-gaap:Revenues");
  assert.deepEqual(s.quarterly.map((v) => [v.end, v.value]), [["2026-09-30", 120], ["2026-06-30", 105]]);
  assert.deepEqual(s.annual.map((v) => v.value), [400]);
  assert.deepEqual(s.instant.map((v) => v.value), [50]);
  assert.equal(seriesFromConcept(units, "USD/shares", "x"), null, "no facts in that unit");
});

test("edgar: a metric the company stopped tagging years ago is dropped, not shown as current", () => {
  const cur = seriesFromConcept({ USD: [f("2026-07-01", "2026-09-30", 1, "2026-11-01")] }, "USD", "a");
  const old = seriesFromConcept({ USD: [f("2013-01-01", "2013-03-31", 1, "2013-05-01")] }, "USD", "b");
  assert.deepEqual(Object.keys(dropStale({ revenue: cur, operating_income: old })), ["revenue"]);
});

test("edgar: filings link to the primary document under the CIK and accession", () => {
  const out = filingsFromSubmissions(320193, {
    filings: { recent: { form: ["10-Q"], filingDate: ["2026-08-01"], reportDate: ["2026-06-27"], accessionNumber: ["0000320193-26-000077"], primaryDocument: ["aapl-20260627.htm"], primaryDocDescription: ["10-Q"] } },
  });
  assert.equal(out[0].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000077/aapl-20260627.htm");
});
