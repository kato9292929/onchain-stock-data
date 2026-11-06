/**
 * Data quality (2026-11-05): per-call data from primary sources only.
 *
 *   1  next earnings — JPX schedule / company announcement, else no date
 *   2  financials    — SEC companyfacts / TDnet 決算短信 XBRL, each value sourced
 *   3  rows          — question, ticker, date, result, evidence; no opaque ids
 *   4  responses     — data only; meanings live in /docs
 *   5  conditions    — the audit of rows already on record
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkedAnnouncements,
  parseJpxSchedule,
  resolveNext,
  universe,
} from "../check-earnings-dates.mjs";
import {
  conditionUniverse,
  edgarFilingUrl,
  parseTanshin,
  parseTdnetList,
  usFinancials,
  yoy,
} from "../fetch-financials.mjs";
import { auditClass } from "../audit-conditions.mjs";

const { catalystFreeBody, catalystFullBody, catalystAccess } = await import("../../lib/catalyst-body.ts");

// ── 1. next earnings ──────────────────────────────────────────────────────

const JPX_URL = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/tvdivq0000001ofb-att/kessan09_1030.xlsx";

test("JPX schedule rows become code → dated announcements", () => {
  const rows = [
    ["決算発表予定日", "コード", "会社名"],
    ["46325", "6920", "レーザーテック", "Lasertec", "46568", "電気機器", "Electric", "第１四半期", "First quarter", "プライム", "Prime"],
    ["46340", "8035", "東京エレクトロン", "TEL", "46477", "電気機器", "Electric", "第２四半期", "Second quarter", "プライム", "Prime"],
    ["", "9999", "blank date"],
  ];
  const m = parseJpxSchedule(rows, JPX_URL);
  assert.deepEqual(m.get("6920"), [{ date: "2026-10-30", period: "第１四半期", source_url: JPX_URL }]);
  assert.equal(m.get("8035")[0].date, "2026-11-14");
  assert.equal(m.has("9999"), false);
});

test("status is confirmed only with a source; JP without a listed date is not_announced; US without one is unverified", () => {
  const jpx = parseJpxSchedule([["46340", "8035"], ["46325", "6920"]], JPX_URL);
  const announced = new Map([["COST", [{ date: "2026-12-10", source_url: "https://investor.costco.com/x", checked_at: "2026-10-28" }]]]);
  const ctx = { jpx, jpxOk: true, announced, today: "2026-11-05", checkedAt: "2026-11-05T00:00:00Z" };
  assert.deepEqual(resolveNext("8035", "JP", ctx), { date: "2026-11-14", status: "confirmed", source_url: JPX_URL, checked_at: "2026-11-05T00:00:00Z" });
  // 6920 reported on 10-30; the next one is not on any list yet.
  assert.equal(resolveNext("6920", "JP", ctx).status, "not_announced");
  assert.equal(resolveNext("6920", "JP", ctx).date, null);
  assert.equal(resolveNext("6920", "JP", { ...ctx, jpxOk: false }).status, "unverified");
  assert.equal(resolveNext("COST", "US", ctx).source_url, "https://investor.costco.com/x");
  assert.deepEqual(resolveNext("NVDA", "US", ctx), { date: null, status: "unverified", source_url: null, checked_at: "2026-11-05T00:00:00Z" });
});

test("a date check counts as an announcement only when it is verified and sourced", () => {
  const h = {
    current: {
      week_of: "2026-10-26",
      holdings: [
        { ticker: "COST", target_date: "2026-12-11", target_date_source: "verified", target_date_confirmed: "2026-12-10", target_date_confirmed_source: "https://investor.costco.com/x", target_date_checked_at: "2026-10-28" },
        { ticker: "NVDA", target_date: "2026-11-19", target_date_source: "model" },
      ],
    },
    history: [],
  };
  const m = checkedAnnouncements(h);
  assert.deepEqual(m.get("COST"), [{ date: "2026-12-10", source_url: "https://investor.costco.com/x", checked_at: "2026-10-28" }]);
  assert.equal(m.has("NVDA"), false, "the model's date is never an announcement");
});

test("the universe covers Solana underlyings, Weekly, Catalysts and IR Fair", () => {
  const u = universe({
    solana: { tokens: [{ ticker: "NVDA" }, { ticker: "brk.b" }] },
    usHistory: { current: { holdings: [{ ticker: "MSFT" }] }, history: [] },
    jpHistory: { current: { holdings: [{ ticker: "6594" }] }, history: [] },
    externals: [{ ticker: "6920", market: "JP" }, { ticker: "ON" }],
    irFair: { catalysts: [{ ticker: "6339" }] },
  });
  assert.deepEqual([...u].sort(), [["6339", "JP"], ["6594", "JP"], ["6920", "JP"], ["BRK.B", "US"], ["MSFT", "US"], ["NVDA", "US"], ["ON", "US"]]);
});

test("the committed earnings file never holds a model date", () => {
  const f = JSON.parse(readFileSync("data/earnings-dates.json", "utf8"));
  for (const [t, e] of Object.entries(f.tickers)) {
    assert.ok(["confirmed", "not_announced", "unverified"].includes(e.status), t);
    if (e.status === "confirmed") assert.match(e.source_url, /^https:\/\//, t);
    else assert.equal(e.date, null, t);
  }
  assert.doesNotMatch(JSON.stringify(f), /"model"/);
});

// ── 2. financials ─────────────────────────────────────────────────────────

test("yoy is (cur − prior) / prior, 1 dp, and null on a missing or non-positive base", () => {
  assert.equal(yoy(96221, 46743), 105.9);
  assert.equal(yoy(40369, 54171), -25.5);
  assert.equal(yoy(10, null), null);
  assert.equal(yoy(10, 0), null);
  assert.equal(yoy(10, -5), null);
});

const fact = (start, end, val, accn, form, filed) => ({ start, end, val, accn, form, filed });
const FACTS = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            fact("2025-04-28", "2025-07-27", 46743, "A-25", "10-Q", "2025-08-27"),
            fact("2025-01-27", "2026-01-25", 215938, "K-26", "10-K", "2026-02-25"),
            fact("2024-01-29", "2025-01-26", 130497, "K-26", "10-K", "2026-02-25"),
            fact("2026-04-27", "2026-07-26", 96221, "Q-26", "10-Q", "2026-08-26"),
            fact("2025-04-28", "2025-07-27", 46743, "Q-26", "10-Q", "2026-08-26"),
            fact("2026-01-26", "2026-07-26", 177837, "Q-26", "10-Q", "2026-08-26"),
          ],
        },
      },
      NetIncomeLoss: {
        units: { USD: [fact("2025-01-27", "2026-01-25", 120067, "D-26", "DEF 14A", "2026-05-12")] },
      },
    },
  },
};

test("US: latest quarter and year from 10-Q / 10-K, prior from the same filing, each with its EDGAR URL", () => {
  const f = usFinancials(FACTS, "0001045810");
  const q = f.latest_quarter.revenue;
  assert.deepEqual([q.value, q.prior_value, q.yoy_pct, q.form, q.filed], [96221, 46743, 105.9, "10-Q", "2026-08-26"]);
  assert.equal(q.source_url, edgarFilingUrl("0001045810", "Q-26"));
  assert.equal(q.prior_source_url, undefined, "prior came from the same filing");
  assert.equal(f.latest_annual.revenue.value, 215938);
  assert.equal(f.latest_annual.revenue.yoy_pct, 65.5);
  // A proxy statement is not a financial filing: no net income rather than a DEF 14A figure.
  assert.equal(f.latest_annual.net_income, null);
  assert.equal(f.latest_quarter.eps_diluted, null, "untagged is null, never derived");
  assert.equal(
    edgarFilingUrl("0000789019", "0001193125-26-436133"),
    "https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/0001193125-26-436133-index.htm",
  );
});

const LIST = `<table><tr>
<td class="oddnew-L kjTime" noWrap>15:45</td>
<td class="oddnew-M kjCode" noWrap>69200</td>
<td class="oddnew-M kjName" noWrap>レーザーテック         </td>
<td class="oddnew-M kjTitle" align="left"><a href="140120261030560435.pdf" target="_blank">2027年6月期　第1四半期決算短信〔日本基準〕　（連結）</a></td>
<td class="oddnew-M kjXbrl" noWrap align="center"><div class="xbrl-mask"><div class="xbrl-button"><a class="style002" href="081220261030560435.zip">XBRL</a></div></div> </td>
<td class="oddnew-M kjPlace" noWrap align="left">東</td>
</tr>
<tr>
<td class="evennew-L kjTime" noWrap>15:40</td>
<td class="evennew-M kjCode" noWrap>53330</td>
<td class="evennew-M kjName" noWrap>ＮＧＫ</td>
<td class="evennew-M kjTitle" align="left"><a href="140120261029559926.pdf" target="_blank">業績予想の修正に関するお知らせ</a></td>
<td class="evennew-M kjXbrl" noWrap align="center"> </td>
</tr></table>`;

test("JP: a TDnet list row gives code, title, time and the PDF / XBRL URLs", () => {
  const rows = parseTdnetList(LIST, "20261030");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    code: "6920",
    company: "レーザーテック",
    title: "2027年6月期　第1四半期決算短信〔日本基準〕　（連結）",
    time: "15:45",
    date: "2026-10-30",
    pdf_url: "https://www.release.tdnet.info/inbs/140120261030560435.pdf",
    xbrl_url: "https://www.release.tdnet.info/inbs/081220261030560435.zip",
  });
  assert.equal(rows[1].xbrl_url, null);
});

const nf = (name, ctx, v, extra = "") =>
  `<ix:nonFraction name="tse-ed-t:${name}" contextRef="${ctx}" unitRef="JPY" decimals="-6" scale="6"${extra}>${v}</ix:nonFraction>`;
const CUR = "CurrentAccumulatedQ1Duration_ConsolidatedMember_ResultMember";
const PRI = "PriorAccumulatedQ1Duration_ConsolidatedMember_ResultMember";
const SUMMARY = [
  nf("NetSales", CUR, "40,369"),
  nf("NetSales", PRI, "54,171"),
  nf("OperatingIncome", CUR, "15,769"),
  nf("OperatingIncome", PRI, "26,728"),
  nf("OrdinaryIncome", CUR, "14,711"),
  nf("OrdinaryIncome", PRI, "27,141"),
  nf("ProfitAttributableToOwnersOfParent", CUR, "10,734"),
  nf("ProfitAttributableToOwnersOfParent", PRI, "19,057"),
  nf("ChangeInNetSales", CUR, "25.5", ' sign="-"'),
  nf("NetSales", "CurrentYearDuration_ConsolidatedMember_ForecastMember", "290,000"),
].join("\n");

test("JP: 短信 summary XBRL → results only (no forecast), in yen, with YoY matching the 短信's own", () => {
  const f = parseTanshin(SUMMARY);
  assert.equal(f.period, "Q1_YTD");
  assert.equal(f.basis, "consolidated");
  assert.deepEqual(f.revenue, { value: 40369000000, unit: "JPY", prior_value: 54171000000, yoy_pct: -25.5 });
  assert.equal(f.operating_income.yoy_pct, -41);
  assert.equal(f.ordinary_income.yoy_pct, -45.8);
  assert.equal(f.net_income.yoy_pct, -43.7);
  // IFRS: no 経常利益 in the filing → null, not a substitute.
  const ifrs = parseTanshin(
    [nf("SalesIFRS", "CurrentYearDuration_ConsolidatedMember_ResultMember", "100"), nf("OperatingIncomeIFRS", "CurrentYearDuration_ConsolidatedMember_ResultMember", "10")].join(""),
  );
  assert.equal(ifrs.period, "FY");
  assert.equal(ifrs.revenue.value, 100000000);
  assert.equal(ifrs.ordinary_income, null);
  assert.equal(parseTanshin("<html>no facts</html>"), null);
});

test("financials universe is every company with a condition; --all adds the Solana list", () => {
  const files = {
    usHistory: { current: { holdings: [{ ticker: "MSFT" }] }, history: [] },
    jpHistory: { current: { holdings: [{ ticker: "6594" }] }, history: [] },
    externals: [{ ticker: "NVDA" }, { ticker: "6920", market: "JP" }],
    irFair: { catalysts: [{ ticker: "6339", market: "JP" }] },
    solana: { tokens: [{ ticker: "AAPL" }] },
  };
  assert.deepEqual(conditionUniverse(files), { us: ["MSFT", "NVDA"], jp: ["6339", "6594", "6920"] });
  assert.deepEqual(conditionUniverse(files, { all: true }).us, ["AAPL", "MSFT", "NVDA"]);
});

test("every committed financial value carries its document URL", () => {
  const f = JSON.parse(readFileSync("data/financials.json", "utf8"));
  let n = 0;
  for (const [t, c] of Object.entries(f.companies)) {
    const periods = c.market === "US" ? [c.latest_quarter, c.latest_annual] : [c.latest];
    for (const p of periods.filter(Boolean)) {
      for (const k of ["revenue", "operating_income", "ordinary_income", "net_income", "eps_diluted"]) {
        const v = p[k];
        if (!v) continue;
        n += 1;
        assert.match(v.source_url ?? "", /^https:\/\/www\.(sec\.gov|release\.tdnet\.info)\//, `${t} ${k}`);
        assert.ok(typeof v.value === "number" || v.value === null, `${t} ${k}`);
      }
    }
  }
  assert.ok(n > 100, `only ${n} values on record`);
});

// ── 3 & 4. /api/catalyst/{ticker} bodies ──────────────────────────────────

const REC = {
  usHistory: { current: null, history: [] },
  usEvals: { evaluations: [] },
  jpHistory: {
    current: { week_of: "2026-10-05", holdings: [{ ticker: "6920", company_name: "レーザーテック", target_date: "2026-10-30", target_date_source: "verified", target_date_confirmed_source: "https://www.release.tdnet.info/inbs/x.pdf" }] },
    history: [],
  },
  jpEvals: {
    evaluations: [
      { week_of: "2026-10-05", ticker: "6920", catalyst_target_date: "2026-10-30", success_condition: "受注が前四半期比増加【外れ方向】減少", status: "hit", evaluated_at: "2026-11-04T00:00:00Z", evidence_url: "https://www.release.tdnet.info/inbs/y.pdf", reasoning: "r" },
    ],
  },
  externals: [],
  irFair: { catalysts: [{ ticker: "1807", company_name: "draft co", market: "JP", sector: "建設", stage: "draft", due_date: null, success_condition: null, fail_condition: null, source: null, status: "pending" }] },
  signals: { signals: [] },
  earnings: { checked_at: "x", tickers: { "6920": { market: "JP", date: null, status: "not_announced", source_url: null, checked_at: "2026-11-05" } } },
  financials: { updated_at: "x", companies: { "6920": { market: "JP", company: "レーザーテック", source: "TDnet 決算短信 XBRL", fetched_at: "x", latest: { revenue: { value: 1, source_url: "https://www.release.tdnet.info/inbs/p.pdf" } } } } },
};

test("/api/catalyst covers Weekly picks: a JP Weekly ticker is paid, a draft is free, unknown is 404", () => {
  assert.equal(catalystAccess("6920", REC), "paid");
  assert.equal(catalystAccess("1807", REC), "free-draft");
  assert.equal(catalystAccess("0000", REC), "not-found");
  assert.equal(catalystFreeBody("0000", REC, "2026-11-05", "https://osd"), null);
});

test("/api/catalyst free and paid views are data only, with full rows", () => {
  const free = catalystFreeBody("6920", REC, "2026-11-05", "https://osd");
  assert.equal(free.name, "レーザーテック");
  assert.equal(free.market, "JP");
  assert.deepEqual(free.next_earnings, { date: null, status: "not_announced", source_url: null, checked_at: "2026-11-05" });
  assert.equal(free.latest_verdict.id, "jp-weekly-2026-10-05-6920");
  assert.equal(free.latest_verdict.question, "受注が前四半期比増加");
  assert.equal(free.latest_verdict.evidence_url, "https://www.release.tdnet.info/inbs/y.pdf");
  assert.equal(free.full.url, "https://osd/api/catalyst/6920");
  assert.equal(free.financials, undefined);

  const full = catalystFullBody("6920", REC, "2026-11-05");
  assert.equal(full.conditions[0].target_date_source_url, "https://www.release.tdnet.info/inbs/x.pdf");
  assert.equal(full.conditions[0].reasoning, "r");
  assert.equal(full.financials.latest.revenue.source_url, "https://www.release.tdnet.info/inbs/p.pdf");
  for (const body of [free, full]) {
    const keys = JSON.stringify(body);
    assert.doesNotMatch(keys, /"note"|_meaning"|target_date_source"/);
    assert.doesNotMatch(keys, /"(us|jp|ext|irf):/);
  }
  const draft = catalystFreeBody("1807", REC, "2026-11-05", "https://osd");
  assert.equal(draft.researched, false);
  assert.equal(draft.full, null);
});

// ── 5. the audit of conditions already on record ──────────────────────────

test("audit classes: vague without a number, no number, unstructured", () => {
  assert.equal(auditClass({ success_condition: "受注が堅調なら当たり", ref: {} }), "A");
  assert.equal(auditClass({ success_condition: "受注が前四半期比で増加", ref: {} }), "B");
  assert.equal(auditClass({ success_condition: "営業利益率 15% 以上", ref: {} }), "C");
  assert.equal(
    auditClass({ success_condition: "営業利益率 15% 以上", ref: { success_conditions: [{ metric: "営業利益率" }] } }),
    null,
  );
});
