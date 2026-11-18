import { test } from "node:test";
import assert from "node:assert/strict";
import { planImport, stockCatalystId } from "../import-from-chat.mjs";
import { CHAT_MODEL } from "../lib/chat-ops.mjs";
import { verdictFor } from "../judge-stocks-edgar.mjs";
import { remainingUniverse } from "../export-stocks-research.mjs";

const { quarterValue } = await import("../../lib/edgar.ts");
const { conditionsFor } = await import("../../lib/company-record.ts");
const { selectionRows } = await import("../../lib/selection.ts");

const ctx = { now: "2026-11-17T00:00:00.000Z", today: "2026-11-17" };
const files = (externals = []) => ({ externals, usHistory: null, usEvals: null, jpHistory: null, jpEvals: null, irFair: null, signals: { signals: [] }, themes: { themes: [] } });
const item = (o = {}) => ({
  ticker: "AAPL",
  company_name: "Apple Inc.",
  metric: "revenue",
  fiscal_period: "Q1",
  fiscal_year: 2027,
  period_end: "2026-12-26",
  operator: ">=",
  threshold: 138000,
  basis: "Guided low-to-mid single-digit growth on 143,756 a year ago.",
  source_url: "https://www.sec.gov/x",
  target_date: "2027-01-29",
  date_confidence: "estimated",
  ...o,
});

test("stock_catalysts: stored as a stocks-us condition with what the EDGAR judge compares", () => {
  const plan = planImport({ type: "stock_catalysts", author: CHAT_MODEL, items: [item()] }, files(), ctx);
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  const row = plan.writes.externals[0];
  assert.equal(row.catalyst_id, stockCatalystId("AAPL", "revenue", "2026-12-26"));
  assert.equal(row.series, "stocks-us");
  assert.deepEqual(row.auto_judge, { metric: "revenue", period_end: "2026-12-26", operator: ">=", threshold: 138000e6 });
  assert.equal(row.success_conditions[0].source_doc, "10-Q");
  // It reads back as an ordinary condition, in the US stocks category.
  const rec = { usHistory: null, usEvals: null, jpHistory: null, jpEvals: null, externals: plan.writes.externals, irFair: null, signals: null };
  assert.equal(conditionsFor("AAPL", rec, "2026-11-17")[0].population, "US stocks research");
  assert.equal(selectionRows(rec, "2026-11-17")[0].group, "us-stocks");
});

test("stock_catalysts: rejects what cannot be judged from EDGAR", () => {
  const bad = [
    item({ metric: "backlog" }),
    item({ metric: "eps_diluted", fiscal_period: "Q4" }),
    item({ threshold: "a lot" }),
    item({ target_date: "2026-11-01" }),
    item({ target_date: "2027-09-01" }),
    item({ source_url: "" }),
  ];
  for (const b of bad) {
    const plan = planImport({ type: "stock_catalysts", author: CHAT_MODEL, items: [b] }, files(), ctx);
    assert.ok(plan.errors?.length, JSON.stringify(b));
  }
  const twice = planImport({ type: "stock_catalysts", author: CHAT_MODEL, items: [item(), item({ metric: "net_income", threshold: 1 })] }, files(), ctx);
  assert.equal(twice.applied, 1, "one condition per company per quarter");
});

const f = (start, end, val, filed, form = "10-Q") => ({ start, end, val, filed, form, accn: `0000000000-26-${val}` });

test("edgar judge: a reported quarter is compared as filed; a fiscal Q4 is the year less nine months; EPS is never derived", () => {
  const units = {
    USD: [
      f("2025-09-28", "2025-12-27", 140, "2026-01-30"),
      f("2025-09-28", "2026-06-27", 400, "2026-08-01"),
      f("2025-09-28", "2026-09-26", 520, "2026-11-03", "10-K"),
    ],
  };
  assert.equal(quarterValue(units, "USD", "2025-12-27", "t", true).how, "reported");
  const q4 = quarterValue(units, "USD", "2026-09-26", "t", true);
  assert.deepEqual([q4.value, q4.how, q4.form], [120, "derived", "10-K"]);
  assert.equal(quarterValue(units, "USD", "2026-09-26", "t", false), null);
  assert.equal(quarterValue(units, "USD", "2026-12-26", "t", true), null, "not filed yet");
});

test("edgar judge: HIT / MISS with the filing as evidence; na only long after the expected date", () => {
  const row = { target_date: "2027-01-29", auto_judge: { metric: "revenue", period_end: "2026-12-26", operator: ">=", threshold: 138000e6 } };
  const filed = { value: 140000e6, how: "reported", form: "10-Q", filed: "2027-01-30", accession: "0000320193-27-000001", tag: "us-gaap:Revenues" };
  const hit = verdictFor(row, filed, "2027-02-01", 320193);
  assert.equal(hit.status, "hit");
  assert.equal(hit.evidence_urls[0], "https://www.sec.gov/Archives/edgar/data/320193/000032019327000001/");
  assert.equal(verdictFor(row, { ...filed, value: 130000e6 }, "2027-02-01", 320193).status, "miss");
  assert.equal(verdictFor(row, null, "2027-02-15", 320193), null, "still waiting");
  assert.equal(verdictFor(row, null, "2027-04-15", 320193).status, "na");
});

test("research universe: SEC filers only, ETFs out, researched or pending companies skipped", () => {
  const tokens = [
    { ticker: "AAPL", name: "Apple" },
    { ticker: "AAPL", name: "Apple (Ondo)" },
    { ticker: "SPY", name: "SPDR", asset_type: "Equity ETF" },
    { ticker: "NVDA", name: "NVIDIA" },
    { ticker: "BARC", name: "Barclays" },
    { ticker: "MSFT", name: "Microsoft" },
  ];
  const sec = new Map([["AAPL", {}], ["SPY", {}], ["NVDA", {}], ["MSFT", {}]]);
  const externals = [{ ticker: "NVDA", status: "pending", series: "physical-ai" }, { ticker: "MSFT", status: "hit", series: "stocks-us" }];
  assert.deepEqual(remainingUniverse(tokens, externals, sec).map((x) => x.ticker), ["AAPL"]);
});
