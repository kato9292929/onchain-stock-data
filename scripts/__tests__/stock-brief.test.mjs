import { test } from "node:test";
import assert from "node:assert/strict";

const { latestQuarter, q4Of, yearAgo } = await import("../../lib/stock-brief.ts");

const v = (start, end, value, form = "10-Q") => ({ start, end, value, form, filed: end, accession: "0000320193-26-000001" });
const series = {
  tag: "us-gaap:Revenues",
  unit: "USD",
  quarterly: [
    v("2026-03-29", "2026-06-27", 109),
    v("2025-12-28", "2026-03-28", 111),
    v("2025-09-28", "2025-12-27", 143),
    v("2025-03-30", "2025-06-28", 94),
    v("2024-12-29", "2025-03-29", 95),
    v("2024-09-29", "2024-12-28", 124),
  ],
  annual: [v("2025-09-28", "2026-09-26", 478, "10-K"), v("2024-09-29", "2025-09-27", 416, "10-K")],
  instant: [],
};

test("brief: a fiscal Q4 is the year less its three quarters, with YoY against last year's Q4", () => {
  assert.equal(q4Of(series, series.annual[0]).value, 478 - 109 - 111 - 143);
  const q = latestQuarter("320193", series);
  assert.equal(q.period_end, "2026-09-26");
  assert.equal(q.value, 115);
  assert.match(q.how, /full year less/);
  assert.equal(q.year_ago.value, 416 - 94 - 95 - 124);
  assert.equal(q.document, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/");
});

test("brief: EPS is never derived — the latest tagged quarter, YoY against the same quarter a year earlier", () => {
  const q = latestQuarter("320193", series, false);
  assert.equal(q.period_end, "2026-06-27");
  assert.equal(q.how, "as filed");
  assert.equal(yearAgo(series.quarterly, series.quarterly[0]).end, "2025-06-28");
});
