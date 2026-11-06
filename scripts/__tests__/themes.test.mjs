/**
 * Themes (2026-11-07): the stock lists the articles were written around, as
 * per-call data that a weekly theme_catalysts import keeps current.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planImport, themeCatalystId } from "../import-from-chat.mjs";
import { buildExport } from "../export-for-chat.mjs";
import { CHAT_MODEL } from "../lib/chat-ops.mjs";

const { membersOf, themesFor, themesIndexBody, themeFreeBody, themeFullBody, findTheme } = await import("../../lib/themes.ts");
const { catalystFreeBody, catalystFullBody } = await import("../../lib/catalyst-body.ts");

const THEMES = {
  updated_at: "2026-11-07",
  themes: [
    { id: "neocloud-us", rank: 1, title_ja: "米国 ネオクラウド", title_en: "Neocloud · US", market: "US", members_from: { kind: "series", series: "neocloud-us" }, articles: [{ url: "https://note.com/x402inc/n/a", title: "18選", published_at: "2026-07-31", pageviews: 295 }] },
    { id: "physical-ai-us", rank: 3, title_ja: "米国 フィジカルAI", title_en: "Physical AI · US", market: "US", members_from: { kind: "series", series: "physical-ai", market: "US" }, articles: [] },
    { id: "weekly-us", rank: 5, title_ja: "米国株 Weekly", title_en: "Weekly · US", market: "US", members_from: { kind: "weekly", market: "US" }, articles: [] },
    { id: "ir-fair-datacenter-power", rank: 7, title_ja: "DC・電力", title_en: "DC · Power", market: "JP", members_from: { kind: "ir-fair-sector", slug: "datacenter-power" }, articles: [] },
  ],
};

const ext = (o) => ({ status: "pending", evidence_urls: [], judgement_date: null, reasoning: null, ...o });
const recOf = (externals = []) => ({
  usHistory: { current: { week_of: "2026-11-02", holdings: [{ ticker: "NVDA", company_name: "NVIDIA", target_date: "2026-11-19" }] }, history: [] },
  usEvals: { evaluations: [{ week_of: "2026-11-02", ticker: "NVDA", catalyst_target_date: "2026-11-19", success_condition: "DC売上 +10%", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null }] },
  jpHistory: { current: null, history: [] },
  jpEvals: { evaluations: [] },
  externals: [
    ext({ catalyst_id: "ext_aa", ticker: "NVDA", market: "US", series: "physical-ai", company_name: "NVIDIA", catalyst_description: "Edge +29%", target_date: "2026-08-27", status: "hit", judgement_date: "2026-09-03", evidence_urls: ["https://nvda/q2"] }),
    ext({ catalyst_id: "ext_bb", ticker: "CRWV", market: "US", series: "neocloud-us", company_name: "CoreWeave", catalyst_description: "Q3 売上 34.5億ドル以上", target_date: "2026-11-20" }),
    ext({ catalyst_id: "ext_cc", ticker: "LAMBDA", market: "US", series: "neocloud-us", company_name: "Lambda", unlisted: true, catalyst_description: "40億ドル調達", target_date: "2026-12-31" }),
    ...externals,
  ],
  irFair: { catalysts: [
    { catalyst_id: "irf-9501", ticker: "9501", company_name: "東京電力", market: "JP", sector: "電気・ガス業", sector_slug: "datacenter-power", stage: "active", due_date: "2026-11-10", success_condition: "経常利益 1,000億円以上", fail_condition: null, source: null, status: "pending" },
    { catalyst_id: "irf-9502", ticker: "9502", company_name: "中部電力", market: "JP", sector: "電気・ガス業", stage: "draft", due_date: null, success_condition: null, fail_condition: null, source: null, status: "pending" },
  ] },
  signals: null,
  earnings: { checked_at: "x", tickers: { CRWV: { market: "US", date: "2026-11-12", status: "confirmed", source_url: "https://investors.coreweave.com/x", checked_at: "2026-11-06" } } },
  themes: THEMES,
});
const SOLANA = { tokens: [{ ticker: "NVDA", issuer: "xStocks", symbol: "NVDAx", solana_mint: "Xsc9" }, { ticker: "CRWV", issuer: "xStocks", symbol: "CRWVx", solana_mint: "XsCR" }] };

test("members come from the series, the current weekly book and the IR Fair sector (no drafts)", () => {
  const rec = recOf();
  const t = (id) => findTheme(THEMES, id);
  assert.deepEqual(membersOf(t("neocloud-us"), rec), [
    { ticker: "CRWV", company: "CoreWeave", listed: true },
    { ticker: "LAMBDA", company: "Lambda", listed: false },
  ]);
  assert.deepEqual(membersOf(t("physical-ai-us"), rec).map((m) => m.ticker), ["NVDA"]);
  assert.deepEqual(membersOf(t("weekly-us"), rec).map((m) => m.ticker), ["NVDA"]);
  assert.deepEqual(membersOf(t("ir-fair-datacenter-power"), rec).map((m) => m.ticker), ["9501"]);
  assert.deepEqual(themesFor("nvda", THEMES, rec), ["physical-ai-us", "weekly-us"]);
});

test("the index counts members and events in the next 14 days", () => {
  const idx = themesIndexBody(THEMES, recOf(), "2026-11-07");
  const neo = idx.themes.find((t) => t.id === "neocloud-us");
  assert.deepEqual([neo.member_count, neo.events_next_14_days], [2, 1], "CRWV reports 11-12; Lambda is 12-31");
  assert.deepEqual(idx.themes.map((t) => t.id), ["neocloud-us", "physical-ai-us", "weekly-us", "ir-fair-datacenter-power"]);
});

test("free theme view: member list with dates and the Solana flag, no catalysts", () => {
  const free = themeFreeBody(findTheme(THEMES, "NEOCLOUD-US"), recOf(), SOLANA, "2026-11-07", "https://osd");
  const crwv = free.members.find((m) => m.ticker === "CRWV");
  assert.equal(crwv.next_earnings.date, "2026-11-12");
  assert.equal(crwv.next_event_date, "2026-11-12");
  assert.equal(crwv.solana_token, true);
  assert.equal(free.members.find((m) => m.ticker === "LAMBDA").solana_token, false);
  assert.equal(free.full.url, "https://osd/api/themes/neocloud-us?view=full");
  assert.equal(free.full.price_usdc, "0.01");
  assert.doesNotMatch(JSON.stringify(free), /question|"note"|_meaning"/);
});

test("paid theme view: current catalyst, latest verdict, every row, mints", () => {
  const full = themeFullBody(findTheme(THEMES, "physical-ai-us"), recOf(), SOLANA, "2026-11-07");
  const nvda = full.members[0];
  assert.equal(nvda.current_catalyst.id, "us-weekly-2026-11-02-NVDA", "the weekly pick is NVDA's next pending catalyst");
  assert.equal(nvda.latest_verdict.result, "hit");
  assert.equal(nvda.latest_verdict.evidence_url, "https://nvda/q2");
  assert.equal(nvda.conditions.length, 2);
  assert.deepEqual(nvda.solana_tokens, [{ issuer: "xStocks", symbol: "NVDAx", solana_mint: "Xsc9" }]);
  assert.doesNotMatch(JSON.stringify(full), /"(us|jp|ext|irf):|target_date_source"|"model"/);
});

// ── theme_catalysts ───────────────────────────────────────────────────────

const files = () => {
  const r = recOf();
  return { usHistory: r.usHistory, usEvals: r.usEvals, jpHistory: r.jpHistory, jpEvals: r.jpEvals, externals: r.externals, irFair: r.irFair, signals: { signals: [] }, themes: THEMES, eras: null };
};
const ctx = { now: "2026-11-07T00:00:00.000Z", today: "2026-11-07" };
const item = (o = {}) => ({
  theme: "neocloud-us",
  market: "US",
  ticker: "NBIS",
  company_name: "Nebius",
  listed: true,
  question: "年末のARRが70億ドル以上",
  fail_direction: "ARRガイダンスの引き下げ",
  success_conditions: [{ metric: "ARR at year-end 2026", operator: ">=", threshold: { value: 7, unit: "USD bn" }, source_doc: "Q4 shareholder letter" }],
  target_date: "2027-02-28",
  date_confidence: "estimated",
  source_url: "https://note.com/x402inc/n/n63fa0862b031",
  ...o,
});

test("theme_catalysts: a structured catalyst is stored under the theme and served the same day", () => {
  const plan = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items: [item(), item({ role: "sub", parent_index: 0, question: "年末の接続済み電力が0.8GW以上", fail_direction: null, success_conditions: [{ metric: "connected power", operator: ">=", threshold: { value: 0.8, unit: "GW" }, source_doc: "Q4 shareholder letter" }] })] }, files(), ctx);
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  assert.equal(plan.applied, 2);
  const added = plan.writes.externals.filter((c) => c.ticker === "NBIS");
  assert.equal(added[0].catalyst_id, themeCatalystId("neocloud-us", "NBIS", "2027-02-28", "年末のARRが70億ドル以上"));
  assert.equal(added[0].series, "neocloud-us");
  assert.equal(added[0].catalyst_description, "年末のARRが70億ドル以上【外れ方向】ARRガイダンスの引き下げ");
  assert.equal(added[1].parent_catalyst_id, added[0].catalyst_id);

  // Same day: the theme and the per-company record both carry it.
  const rec = { ...recOf(), externals: plan.writes.externals };
  const full = themeFullBody(findTheme(THEMES, "neocloud-us"), rec, SOLANA, "2026-11-07");
  const nbis = full.members.find((m) => m.ticker === "NBIS");
  assert.ok(nbis, "a new ticker joins the series theme");
  assert.equal(nbis.current_catalyst.target_date, "2027-02-28");
  assert.deepEqual(nbis.conditions.map((r) => r.success_conditions[0].metric).sort(), ["ARR at year-end 2026", "connected power"]);
  const cat = catalystFullBody("NBIS", rec, "2026-11-07");
  assert.equal(cat.conditions.length, 2);
  assert.deepEqual(cat.themes, ["neocloud-us"]);
  assert.equal(catalystFreeBody("NBIS", rec, "2026-11-07", "https://osd").researched, true);
});

test("theme_catalysts: bad items are listed and skipped, a resend is a no-op", () => {
  const items = [
    item(),
    item({ ticker: "IREN", theme: "no-such-theme" }),
    item({ ticker: "HUT", question: "受注が堅調なら当たり", success_conditions: [] }),
    item({ ticker: "CIFR", source_url: "" }),
    item({ ticker: "WULF", role: "sub", parent_index: 9 }),
  ];
  const plan = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items }, files(), ctx);
  assert.equal(plan.applied, 1);
  const why = Object.fromEntries(plan.rejected.map((r) => [r.index, r.reasons.join(" / ")]));
  assert.match(why[1], /not in data\/themes\.json/);
  assert.match(why[2], /vague wording \(堅調\)/);
  assert.match(why[2], /success_conditions .* is required/);
  assert.match(why[3], /source_url/);
  assert.match(why[4], /parent_index/);

  const again = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items: [item()] }, { ...files(), externals: plan.writes.externals }, ctx);
  assert.match(again.errors.join(), /already on record/);
  assert.match(planImport({ type: "theme_catalysts", author: "someone", items: [item()] }, files(), ctx).errors.join(), /author must be/);
});

test("the chat export lists each theme's members with an event in the next 14 days (E)", () => {
  const f = { ...files(), signals: { signals: [] }, earnings: recOf().earnings };
  const { markdown, counts } = buildExport(f, { today: "2026-11-07", since: null });
  assert.match(markdown, /## E\. テーマの更新/);
  assert.match(markdown, /### neocloud-us（米国 ネオクラウド）/);
  assert.match(markdown, /\| CRWV \| CoreWeave \| 2026-11-12 \|/);
  assert.doesNotMatch(markdown.split("## E.")[1], /LAMBDA/, "Lambda's date is past the 14-day window");
  assert.ok(counts.theme_rows >= 3);
});

test("committed themes: every theme resolves, neocloud carries the 10/20 article conditions", () => {
  const themes = JSON.parse(readFileSync("data/themes.json", "utf8"));
  const externals = JSON.parse(readFileSync("data/external-catalysts.json", "utf8"));
  const neo = externals.filter((c) => c.series?.startsWith("neocloud-"));
  assert.equal(neo.length, 31);
  for (const c of neo) {
    assert.ok(c.success_conditions?.length > 0, c.ticker);
    assert.match(c.source_url, /^https:\/\/note\.com\/x402inc\/n\//);
  }
  assert.deepEqual(themes.themes.slice(0, 3).map((t) => t.id), ["neocloud-us", "neocloud-jp", "physical-ai-us"]);
  // The Physical AI scoreboard is unchanged: neocloud rows are a different series.
  assert.equal(externals.filter((c) => c.series === "physical-ai").length, 89);
});
