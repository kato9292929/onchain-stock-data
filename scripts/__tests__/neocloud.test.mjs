/**
 * Neocloud (2026-11-12): business numbers recorded per filing (metrics), the
 * 7-day filing feed for the chat, and the free / paid bodies built from them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planImport, metricId, normalizeMetric, isReprint } from "../import-from-chat.mjs";
import { numberPatterns, findNumber } from "../neocloud-sources.mjs";
import { buildExport } from "../export-for-chat.mjs";
import {
  excerpt,
  exhibitsFromIndex,
  filingsFromSubmissions,
  htmlToText,
  mergeFilingIndex,
  renderFeed,
} from "../lib/neocloud-feed.mjs";
import { quarterStart } from "../export-neocloud.mjs";

const {
  companyFreeBody,
  companyFullBody,
  digestFreeBody,
  digestFullBody,
  latestMetrics,
  metricSeries,
  neocloudCompanies,
  nextReporters,
  powerTotals,
  windowStart,
} = await import("../../lib/neocloud.ts");
const { themeFreeBody, themeFullBody, findTheme } = await import("../../lib/themes.ts");

const TODAY = "2026-11-12";
const SEC = "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000461";
const THEMES = {
  updated_at: "2026-11-07",
  themes: [
    {
      id: "neocloud-us", rank: 1, title_ja: "米国 ネオクラウド", title_en: "Neocloud · US", market: "US", kind: "article",
      lineage: [{ url: "https://note.com/x/n/a", title: "10/20", published_at: "2026-10-20", pageviews: null, role: "latest" }],
      members: [
        { ticker: "CRWV", company: "CoreWeave", listed: true },
        { ticker: "IREN", company: "IREN", listed: true },
        { ticker: "LAMBDA", company: "Lambda", listed: false },
      ],
    },
    {
      id: "neocloud-jp", rank: 2, title_ja: "日本 ネオクラウド", title_en: "Neocloud · Japan", market: "JP", kind: "article",
      lineage: [{ url: "https://note.com/x/n/b", title: "10/20", published_at: "2026-10-20", pageviews: null, role: "latest" }],
      members: [{ ticker: "3778", company: "さくらインターネット", listed: true }],
    },
  ],
};

const row = (o = {}) => ({
  ticker: "CRWV",
  item: "contracted_power_mw",
  value: 4600,
  unit: "MW",
  as_of: "2026-09-30",
  source_url: `${SEC}/coreweave3q26earningspress.htm`,
  published_at: "2026-11-10",
  ...o,
});
const files = (metrics = null) => ({ themes: THEMES, neocloudMetrics: metrics });
const ctx = { now: `${TODAY}T00:00:00.000Z`, today: TODAY };

// ── import ────────────────────────────────────────────────────────────────

test("metrics: a disclosed number with its document is recorded once", () => {
  const plan = planImport({ type: "metrics", items: [row(), row({ item: "energized_mw", value: 1700 })] }, files(), ctx);
  assert.equal(plan.applied, 2);
  assert.deepEqual(plan.rejected, []);
  const rows = plan.writes.neocloudMetrics.metrics;
  assert.equal(rows[0].id, metricId(rows[0]));
  assert.equal(rows[0].market, "US");
  // Re-sending the same answer adds nothing.
  const again = planImport({ type: "metrics", items: [row()] }, files(plan.writes.neocloudMetrics), ctx);
  assert.equal(again.applied, 0);
  assert.match(again.rejected[0].reasons.join(), /already recorded/);
});

test("metrics: no URL, no estimate, no stranger, MW for power, a period for guidance", () => {
  const items = [
    row({ source_url: "" }),
    row({ estimated: true }),
    row({ ticker: "NVDA" }),
    row({ unit: "kW", value: 4600000 }),
    row({ item: "revenue_guidance", unit: "USD", value: null, low: 13e9, high: 13.3e9 }),
    row({ item: "backlog_usd", unit: "EUR", value: 132.5e9 }),
    row({ as_of: "2026-12-31" }),
    row({ item: "financing", unit: "USD", value: 4.2e9 }),
    row({ item: "key_contracts", unit: "USD", value: 1e9, detail: { term: "5y" } }),
  ];
  const plan = planImport({ type: "metrics", items }, files(), ctx);
  assert.equal(plan.applied, 0);
  const why = plan.rejected.map((r) => r.reasons.join("; "));
  assert.match(why[0], /source_url/);
  assert.match(why[1], /estimates/);
  assert.match(why[2], /not a neocloud member/);
  assert.match(why[3], /MW/);
  assert.match(why[4], /period/);
  assert.match(why[5], /USD or JPY/);
  assert.match(why[6], /after published_at/);
  assert.match(why[7], /instrument/);
  assert.match(why[8], /counterparty/);
});

test("metrics: not disclosed is a null row; guidance ranges and JP yen are kept as given", () => {
  const plan = planImport(
    {
      type: "metrics",
      items: [
        row({ item: "backlog_usd", unit: "USD", value: null, note: "10-Q に受注残の記載なし" }),
        row({ item: "revenue_guidance", unit: "USD", value: null, low: 13e9, high: 13.3e9, period: "FY2026" }),
        row({ ticker: "3778", item: "revenue_guidance", unit: "JPY", value: 45e9, period: "2027年3月期", source_url: "https://www.release.tdnet.info/inbs/x.pdf", as_of: "2026-10-28", published_at: "2026-10-28" }),
      ],
    },
    files(),
    ctx,
  );
  assert.equal(plan.applied, 3);
  assert.deepEqual(plan.notes[1], "項目別: backlog_usd 1・revenue_guidance 2");
  const jp = plan.writes.neocloudMetrics.metrics.find((r) => r.ticker === "3778");
  assert.equal(jp.market, "JP");
});

test("metrics: the chat's spellings are read as the schema's — renames and exact unit factors only", () => {
  const n = normalizeMetric({ ticker: "CRWV", metric: "revenue_guidance", value: 13.0, value_high: 13.3, unit: "USD bn", as_of: "2026-12-31", published_at: "2026-11-10" });
  assert.deepEqual(
    { item: n.item, value: n.value, low: n.low, high: n.high, unit: n.unit, as_of: n.as_of, period: n.period },
    { item: "revenue_guidance", value: null, low: 13e9, high: 13.3e9, unit: "USD", as_of: "2026-11-10", period: "〜2026-12-31" },
  );
  assert.equal(normalizeMetric({ metric: "financing", value: 0.775, unit: "USD bn" }).value, 775000000);
  assert.equal(normalizeMetric({ metric: "contracted_power_mw", value: 4.6, unit: "GW" }).value, 4600);
  assert.equal(normalizeMetric({ metric: "key_contracts", value: null, unit: null }).unit, null);
  // A non-guidance number dated after its document is still refused.
  assert.equal(normalizeMetric({ metric: "contracted_power_mw", value: 1, unit: "MW", as_of: "2026-12-31", published_at: "2026-11-10" }).as_of, "2026-12-31");

  const plan = planImport(
    {
      type: "metrics",
      items: [
        { ticker: "CRWV", metric: "financing", value: 4.2, unit: "USD bn", as_of: "2026-09-30", source_url: `${SEC}/press.htm`, published_at: "2026-11-10", note: "転換社債" },
        { ticker: "CRWV", metric: "financing", value: 2.6, unit: "USD bn", as_of: "2026-09-30", source_url: `${SEC}/press.htm`, published_at: "2026-11-10", note: "DDTL 5.5" },
        { ticker: "CRWV", metric: "key_contracts", value: null, unit: null, as_of: "2026-11-10", source_url: `${SEC}/press.htm`, published_at: "2026-11-10", note: "契約額は非開示" },
        { ticker: "CRWV", metric: "energized_mw", value: 1700, unit: "MW", as_of: "2026-09-30", source_url: "https://menafn.com/x", published_at: "2026-11-10" },
      ],
    },
    files(),
    ctx,
  );
  assert.equal(plan.applied, 3, "two financings from one document are two rows");
  assert.match(plan.rejected[0].reasons.join(), /reprint/);
  assert.equal(isReprint("https://www.finviz.com/news/1"), true);
  assert.equal(isReprint("https://www.sec.gov/Archives/x.htm"), false);
});

test("sources: a number counts as found only where the document prints it", () => {
  const text = "RPO were 38.7 billion. We now expect ARR to exceed 7 billion. 1,590 million of notes. 102 MW online; over 1.7 GW active.";
  assert.match(findNumber(text, 7.0, "USD bn"), /exceed 7 billion/, "not the 7 of 38.7");
  assert.ok(findNumber(text, 1.59, "USD bn"));
  assert.ok(findNumber(text, 102, "MW"));
  assert.ok(findNumber(text, 1700, "MW"));
  assert.equal(findNumber(text, 8.7, "USD bn"), null);
  assert.equal(numberPatterns(null, "MW").length, 0);
});

// ── bodies ────────────────────────────────────────────────────────────────

const M = (o) => ({ id: `nm_${Math.random().toString(16).slice(2, 12)}`, market: "US", ...row(), ...o });
const METRICS = {
  updated_at: TODAY,
  metrics: [
    M({ id: "a", as_of: "2026-06-30", value: 3700, published_at: "2026-08-12", source_url: `${SEC}/q2.htm` }),
    M({ id: "b", as_of: "2026-09-30", value: 4600 }),
    M({ id: "c", item: "energized_mw", value: 1700 }),
    M({ id: "d", item: "backlog_usd", unit: "USD", value: null, as_of: "2026-09-30", published_at: "2026-11-12" }),
    M({ id: "e", item: "backlog_usd", unit: "USD", value: 132.5e9, as_of: "2026-09-30" }),
    M({ id: "f", ticker: "IREN", value: 3000, published_at: "2026-11-05" }),
  ],
};

test("latest: the newest row that states something, else the null row, else null", () => {
  const l = latestMetrics(METRICS, "crwv");
  assert.equal(l.contracted_power_mw.value, 4600);
  assert.equal(l.backlog_usd.value, 132.5e9, "a later 'not stated' does not hide the stated number");
  assert.equal(l.financing, null);
  assert.deepEqual(
    metricSeries(METRICS, "CRWV").filter((r) => r.item === "contracted_power_mw").map((r) => r.value),
    [3700, 4600],
  );
});

test("power totals sum only the companies that disclosed, and say how many did", () => {
  const t = powerTotals(neocloudCompanies(THEMES), METRICS);
  assert.deepEqual(t.US, { contracted_power_mw: 7600, contracted_companies: 2, energized_mw: 1700, energized_companies: 1, companies: 3 });
  assert.equal(t.JP.contracted_companies, 0);
});

test("digest: the last 7 days, filings and new numbers beside the previous one", () => {
  const filings = {
    updated_at: TODAY,
    filings: [
      { ticker: "CRWV", market: "US", form: "8-K", title: "8-K · Items 2.02", filed_at: "2026-11-10", url: `${SEC}/crwv-20261110.htm` },
      { ticker: "IREN", market: "US", form: "10-Q", title: "10-Q", filed_at: "2026-11-05", url: "https://www.sec.gov/x" },
    ],
  };
  assert.equal(windowStart(TODAY), "2026-11-06");
  const input = { themes: THEMES, metrics: METRICS, filings, signals: { signals: [] }, today: TODAY };
  const free = digestFreeBody(input, "https://osd.example");
  assert.deepEqual(free.companies.map((c) => c.ticker), ["CRWV"], "IREN's 11-05 is outside the window");
  assert.equal(free.full.url, "https://osd.example/api/neocloud/digest?view=full");
  const full = digestFullBody(input);
  const cp = full.companies[0].metric_changes.find((r) => r.item === "contracted_power_mw");
  assert.equal(cp.previous.value, 3700);
  assert.equal(cp.change, 900);
});

test("company and theme bodies carry the numbers; the paid one adds the series and documents", () => {
  const rec = { themes: THEMES, neocloud: METRICS, neocloudFilings: null, externals: [], usHistory: null, usEvals: null, signals: null, earnings: null };
  const company = neocloudCompanies(THEMES).find((c) => c.ticker === "CRWV");
  const free = companyFreeBody({ company, rec, metrics: METRICS, filings: null, today: TODAY }, "https://osd.example");
  assert.equal(free.full.url, "https://osd.example/api/neocloud/CRWV?view=full");
  assert.equal(free.latest.energized_mw.value, 1700);
  assert.equal("series" in free, false);
  const full = companyFullBody({ company, rec, metrics: METRICS, filings: null, today: TODAY });
  assert.equal(full.series.length, 5);
  assert.ok(full.documents.some((d) => d.url.endsWith("q2.htm")));

  const theme = findTheme(THEMES, "neocloud-us");
  const tf = themeFreeBody(theme, rec, null, TODAY, "https://osd.example");
  assert.equal(tf.power_totals.contracted_power_mw, 7600);
  assert.equal(tf.members.find((m) => m.ticker === "CRWV").power.contracted_power_mw.value, 4600);
  assert.equal(themeFullBody(theme, rec, null, TODAY).members.find((m) => m.ticker === "CRWV").metrics.length, 5);
  assert.deepEqual(nextReporters(neocloudCompanies(THEMES), rec, TODAY), []);
});

// ── feed ──────────────────────────────────────────────────────────────────

test("filings: forms and dates from the EDGAR submissions list", () => {
  const json = {
    filings: {
      recent: {
        form: ["10-Q", "8-K", "4", "8-K"],
        filingDate: ["2026-11-12", "2026-11-10", "2026-11-10", "2026-09-17"],
        reportDate: ["2026-09-30", "2026-11-10", "", "2026-09-17"],
        accessionNumber: ["0001769628-26-000465", "0001769628-26-000461", "x", "y"],
        primaryDocument: ["crwv-20260930.htm", "crwv-20261110.htm", "x.xml", "y.htm"],
        primaryDocDescription: ["10-Q", "8-K", "", ""],
        items: ["", "2.02,9.01", "", ""],
      },
    },
  };
  const rows = filingsFromSubmissions("CRWV", "0001769628", json, { from: "2026-11-06", to: TODAY });
  assert.deepEqual(rows.map((r) => r.form), ["10-Q", "8-K"]);
  assert.equal(rows[1].url, `${SEC}/crwv-20261110.htm`);
  assert.match(rows[1].title, /Items 2\.02/);
});

test("exhibits: Ex.99 found by the index page's Type column, whatever the file is called", () => {
  const html = `<table><tr><td>1</td><td>8-K</td><td><a href="/ix?doc=/Archives/x/crwv-20261110.htm">a</a></td><td>8-K</td></tr>
<tr class="evenRow"><td>2</td><td>EX-99.1</td><td><a href="/Archives/edgar/data/1769628/000176962826000461/coreweave3q26earningspress.htm">b</a></td><td>EX-99.1</td><td>1</td></tr>
<tr><td>3</td><td>XBRL</td><td><a href="/Archives/x/crwv.xsd">c</a></td><td>EX-101.SCH</td></tr></table>`;
  assert.deepEqual(exhibitsFromIndex(html, SEC), [{ label: "EX-99.1", url: `${SEC}/coreweave3q26earningspress.htm` }]);
});

test("excerpt: lines with a term and a number, with context, without the boilerplate", () => {
  const text = htmlToText(
    "<p>Intro text.</p><p>Grew total contracted power more than 900 MW to over 4.6 GW.</p><p>Next line.</p>" +
      "<p>This release contains forward-looking statements about our 2026 guidance.</p>" +
      "<table><tr><td>Revenue backlog</td><td>$ 132.5</td></tr></table>",
  );
  assert.match(text, /Revenue backlog \| \$ 132\.5/);
  const parts = excerpt(text);
  assert.ok(parts.some((p) => p.includes("4.6 GW") && p.includes("Intro text.")));
  assert.ok(parts.some((p) => p.includes("132.5")));
  assert.ok(!parts.some((p) => p.split("\n").every((l) => /forward-looking/.test(l))));
});

test("the chat export gets an F section, first in priority; offline says it did not fetch", () => {
  const feed = {
    from: "2026-11-06",
    to: TODAY,
    mode: "window",
    errors: [],
    companies: neocloudCompanies(THEMES),
    filings: [
      { ticker: "CRWV", market: "US", form: "8-K", title: "8-K · Items 2.02", filed_at: "2026-11-10", url: `${SEC}/crwv-20261110.htm`, company: "CoreWeave",
        docs: [{ label: "EX-99.1", url: `${SEC}/press.htm`, excerpts: ["Grew total contracted power to over 4.6 GW"] }] },
    ],
  };
  const base = { usEvals: { evaluations: [] }, usHistory: { current: null, history: [] }, jpEvals: { evaluations: [] }, jpHistory: { current: null, history: [] }, externals: [], irFair: { catalysts: [] }, signals: { signals: [] }, themes: THEMES, earnings: null, jpListed: null };
  const { markdown, counts } = buildExport(base, { today: TODAY, since: null, neocloud: feed });
  assert.match(markdown, /最優先は F 節/);
  assert.match(markdown, /## F\. ネオクラウドの直近7日の開示/);
  assert.match(markdown, /#### CRWV CoreWeave（US）/);
  assert.match(markdown, /4\.6 GW/);
  assert.match(markdown, /この期間に開示がない会社：IREN IREN、3778/);
  assert.equal(counts.neocloud_filings, 1);
  assert.match(buildExport(base, { today: TODAY, since: null }).markdown, /取得していない（--offline）/);
  assert.match(renderFeed({ ...feed, filings: [] }, { heading: "# x" }), /この期間の開示はありません/);
});

test("the filing index keeps metadata only, newest first, for 120 days", () => {
  const m = mergeFilingIndex(
    { filings: [{ ticker: "IREN", market: "US", form: "10-Q", title: "t", filed_at: "2026-05-01", url: "https://old" }] },
    [{ ticker: "CRWV", market: "US", form: "8-K", title: "t", filed_at: "2026-11-10", url: "https://new" }],
    TODAY,
  );
  assert.deepEqual(m.filings.map((f) => f.url), ["https://new"]);
  assert.equal(quarterStart(TODAY), "2026-10-01");
});

// ── committed data ────────────────────────────────────────────────────────

test("committed: the neocloud themes have US 18 / JP 5, and every metric row has a document", () => {
  const themes = JSON.parse(readFileSync("data/themes.json", "utf8"));
  const cs = neocloudCompanies(themes);
  assert.equal(cs.filter((c) => c.market === "US").length, 18);
  assert.equal(cs.filter((c) => c.market === "JP").length, 5);
  const metrics = JSON.parse(readFileSync("data/neocloud-metrics.json", "utf8"));
  assert.equal(metrics.metrics.filter((r) => !/^https?:\/\//.test(r.source_url ?? "")).length, 0);
});
