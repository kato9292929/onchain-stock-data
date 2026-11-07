/**
 * Themes (2026-11-07): sector × market, members following the latest article
 * edition, older editions kept with a status, Weekly picks in their sector,
 * and a weekly theme_catalysts import that shows up the same day.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planImport, themeCatalystId } from "../import-from-chat.mjs";
import { buildExport } from "../export-for-chat.mjs";
import { CHAT_MODEL } from "../lib/chat-ops.mjs";

const { membersOf, themesFor } = await import("../../lib/theme-members.ts");
const { themesIndexBody, themeFreeBody, themeFullBody, findTheme, needsRenewal } = await import("../../lib/themes.ts");
const { conditionsFor } = await import("../../lib/company-record.ts");
const { catalystFreeBody, catalystFullBody } = await import("../../lib/catalyst-body.ts");

const N = "https://note.com/x402inc/n/";
const THEMES = {
  updated_at: "2026-11-07",
  themes: [
    {
      id: "neocloud-us", rank: 1, title_ja: "米国 ネオクラウド", title_en: "Neocloud · US", market: "US", kind: "article",
      lineage: [
        { url: `${N}old`, title: "7/31", published_at: "2026-07-31", pageviews: 295 },
        { url: `${N}new`, title: "10/20", published_at: "2026-10-20", pageviews: null, role: "latest" },
      ],
      members: [
        { ticker: "CRWV", company: "CoreWeave", listed: true, group: "GPUクラウド直販" },
        { ticker: "LAMBDA", company: "Lambda", listed: false, group: "GPUクラウド直販" },
        { ticker: "FOUNDRY", company: "Foundry", listed: false, group: "マーケットプレイス" },
      ],
    },
    {
      id: "physical-ai-semis-us", rank: 3, title_ja: "米国 フィジカルAI 半導体", title_en: "Physical AI · Semis · US", market: "US", kind: "article",
      lineage: [{ url: `${N}semis`, title: "10選", published_at: "2026-07-31", pageviews: 93, role: "latest" }],
      members: [{ ticker: "NVDA", company: "NVIDIA", listed: true, group: "汎用の下層" }],
    },
    { id: "weekly-jp", rank: 101, title_ja: "日本株 Weekly", title_en: "Weekly · Japan", market: "JP", kind: "weekly", lineage: [] },
    {
      id: "semiconductor-supply-chain-jp", rank: 7, title_ja: "日本 半導体・AIサプライチェーン", title_en: "Semis · Japan", market: "JP", kind: "sector",
      weekly_sector: "semiconductors-fa",
      lineage: [{ url: `${N}map`, title: "map", published_at: "2026-08-28", pageviews: null }],
      members: [{ ticker: "5142", company: "アキレス", listed: true, source_article: `${N}map` }],
    },
    {
      id: "food-staples-jp", rank: 15, title_ja: "日本 食品", title_en: "Food · Japan", market: "JP", kind: "sector",
      lineage: [{ url: `${N}map`, title: "map", published_at: "2026-08-28", pageviews: null }],
      members: [{ ticker: "2001", company: "ニップン", listed: true, source_article: `${N}map` }],
    },
  ],
};

const ext = (o) => ({ status: "pending", evidence_urls: [], judgement_date: null, reasoning: null, catalyst_role: "main", ...o });
const recOf = (externals = []) => ({
  usHistory: { current: null, history: [] },
  usEvals: { evaluations: [] },
  jpHistory: { current: { week_of: "2026-10-26", holdings: [{ ticker: "8035", company_name: "東京エレクトロン" }] }, history: [] },
  jpEvals: { evaluations: [{ week_of: "2026-10-26", ticker: "8035", catalyst_target_date: "2026-11-20", success_condition: "装置売上 +20%", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null }] },
  externals: [
    ext({ catalyst_id: "ext_old1", ticker: "CRWV", market: "US", series: "neocloud-us", company_name: "CoreWeave", catalyst_description: "7月の条件", target_date: "2026-12-31", edition: "history", superseded_by: "ext_new1", source_url: `${N}old` }),
    ext({ catalyst_id: "ext_new1", ticker: "CRWV", market: "US", series: "neocloud-us", company_name: "CoreWeave", catalyst_description: "Q3 売上 34.5億ドル以上", target_date: "2026-11-20", source_url: `${N}new` }),
    ext({ catalyst_id: "ext_lam", ticker: "LAMBDA", market: "US", series: "neocloud-us", company_name: "Lambda", unlisted: true, catalyst_description: "40億ドル調達", target_date: "2026-12-31" }),
    ext({ catalyst_id: "ext_nv1", ticker: "NVDA", market: "US", series: "physical-ai", company_name: "NVIDIA", catalyst_description: "Edge +29%", target_date: "2026-08-27", status: "hit", judgement_date: "2026-09-03", evidence_urls: ["https://nvda/q2"], source_article: `${N}n424f463e7002` }),
    ext({ catalyst_id: "ext_nv2", ticker: "NVDA", market: "US", series: "physical-ai", company_name: "NVIDIA", catalyst_description: "Q3 DC +10%", target_date: "2026-11-01" }),
    ext({ catalyst_id: "ext_gone", ticker: "ONEX", market: "US", series: "physical-ai", company_name: "1X", catalyst_description: "x", target_date: "2026-12-31", superseded_at: "2026-11-07", superseded_reason: "7/31 版で銘柄から外れた" }),
    ...externals,
  ],
  irFair: { catalysts: [] },
  signals: null,
  earnings: { checked_at: "x", tickers: { CRWV: { market: "US", date: "2026-11-12", status: "confirmed", source_url: "https://investors.coreweave.com/x", checked_at: "2026-11-06" } } },
  themes: THEMES,
  jpListed: { listed: { 8035: { name: "東京エレクトロン", sector33: "電気機器" }, 2001: { name: "ニップン", sector33: "食料品" } } },
});
const SOLANA = { tokens: [{ ticker: "NVDA", issuer: "xStocks", symbol: "NVDAx", solana_mint: "Xsc9" }, { ticker: "CRWV", issuer: "xStocks", symbol: "CRWVx", solana_mint: "XsCR" }] };
const TODAY = "2026-11-07";

test("members: the latest edition's list with groups, catalysts added later, and JP Weekly picks in their sector", () => {
  const rec = recOf([ext({ catalyst_id: "ext_add", ticker: "NBIS", market: "US", series: "neocloud-us", company_name: "Nebius", catalyst_description: "ARR", target_date: "2027-02-28" })]);
  const neo = membersOf(findTheme(THEMES, "neocloud-us"), rec);
  assert.deepEqual(neo.map((m) => [m.ticker, m.group ?? null, m.via]), [
    ["CRWV", "GPUクラウド直販", "article"],
    ["LAMBDA", "GPUクラウド直販", "article"],
    ["FOUNDRY", "マーケットプレイス", "article"],
    ["NBIS", null, "added"],
  ]);
  const semis = membersOf(findTheme(THEMES, "semiconductor-supply-chain-jp"), rec);
  assert.deepEqual(semis.map((m) => [m.ticker, m.via]), [["5142", "article"], ["8035", "weekly"]], "a JP pick in 電気機器 joins the semis sector");
  assert.deepEqual(membersOf(findTheme(THEMES, "food-staples-jp"), rec).map((m) => m.ticker), ["2001"], "食料品 picks do not");
  assert.deepEqual(themesFor("8035", THEMES, rec), ["semiconductor-supply-chain-jp"]);
  assert.deepEqual(themesFor("MSFT", THEMES, rec), []);
});

test("row status: active, judged, superseded (with its replacement), expired", () => {
  const rec = recOf();
  const crwv = conditionsFor("CRWV", rec, TODAY);
  const old = crwv.find((r) => r.question === "7月の条件");
  assert.equal(old.status, "superseded");
  assert.equal(old.superseded_by, "neocloud-us-new1");
  assert.equal(old.source_article, `${N}old`);
  assert.equal(crwv.find((r) => r.id === "neocloud-us-new1").status, "active");
  const nvda = conditionsFor("NVDA", rec, TODAY);
  assert.deepEqual(nvda.map((r) => r.status).sort(), ["expired", "judged"]);
  assert.equal(nvda.find((r) => r.status === "judged").source_article, `${N}n424f463e7002`);
  const gone = conditionsFor("ONEX", rec, TODAY)[0];
  assert.deepEqual([gone.status, gone.superseded_by], ["superseded", null], "dropped from the edition, not replaced");
  // Weekly rows carry the sector theme of the pick.
  assert.deepEqual(conditionsFor("8035", rec, TODAY)[0].themes, ["semiconductor-supply-chain-jp"]);
});

test("index: themes with active catalysts first, weekly selections apart, no-catalyst themes report 0", () => {
  const idx = themesIndexBody(THEMES, recOf(), TODAY);
  assert.deepEqual(idx.themes.map((t) => [t.id, t.active_catalysts]), [
    ["neocloud-us", 2],
    ["semiconductor-supply-chain-jp", 1],
    ["physical-ai-semis-us", 0],
    ["food-staples-jp", 0],
  ]);
  assert.deepEqual(idx.selections.map((t) => t.id), ["weekly-jp"]);
  assert.equal(idx.themes[0].latest_article, `${N}new`);
});

test("free theme view: lineage with the latest marked, groups, members without catalysts still listed", () => {
  const free = themeFreeBody(findTheme(THEMES, "NEOCLOUD-US"), recOf(), SOLANA, TODAY, "https://osd");
  assert.deepEqual(free.lineage.map((a) => [a.published_at, a.latest]), [["2026-07-31", false], ["2026-10-20", true]]);
  const foundry = free.members.find((m) => m.ticker === "FOUNDRY");
  assert.deepEqual([foundry.active_catalysts, foundry.group, foundry.listed], [0, "マーケットプレイス", false]);
  const crwv = free.members.find((m) => m.ticker === "CRWV");
  assert.equal(crwv.next_event_date, "2026-11-12");
  assert.equal(crwv.solana_token, true);
  assert.equal(free.full.url, "https://osd/api/themes/neocloud-us?view=full");
  assert.doesNotMatch(JSON.stringify(free), /question|"note"|_meaning"|ir-fair/);
});

test("paid theme view: the current catalyst is the active one; the sector page shows the Weekly pick's rows", () => {
  const full = themeFullBody(findTheme(THEMES, "neocloud-us"), recOf(), SOLANA, TODAY);
  const crwv = full.members.find((m) => m.ticker === "CRWV");
  assert.equal(crwv.current_catalyst.id, "neocloud-us-new1");
  assert.deepEqual(crwv.status_counts, { active: 1, judged: 0, superseded: 1, expired: 0 });
  assert.deepEqual(full.members.find((m) => m.ticker === "FOUNDRY").conditions, []);
  const semis = themeFullBody(findTheme(THEMES, "semiconductor-supply-chain-jp"), recOf(), SOLANA, TODAY);
  const tel = semis.members.find((m) => m.ticker === "8035");
  assert.equal(tel.group, "Weekly");
  assert.equal(tel.current_catalyst.id, "jp-weekly-2026-10-26-8035");
  assert.doesNotMatch(JSON.stringify(full), /"(us|jp|ext|irf):|target_date_source"|"model"/);
});

test("renewal list: listed members whose conditions all ran out; never-covered members are left out", () => {
  const out = needsRenewal(THEMES, recOf(), TODAY);
  assert.deepEqual(out.map((x) => [x.theme.id, x.members.map((m) => m.ticker)]), [["physical-ai-semis-us", ["NVDA"]]]);
  assert.equal(out[0].members[0].last.status, "expired");
});

// ── theme_catalysts ───────────────────────────────────────────────────────

const files = () => {
  const r = recOf();
  return { usHistory: r.usHistory, usEvals: r.usEvals, jpHistory: r.jpHistory, jpEvals: r.jpEvals, externals: r.externals, irFair: r.irFair, signals: { signals: [] }, themes: THEMES, eras: null };
};
const ctx = { now: "2026-11-07T00:00:00.000Z", today: TODAY };
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
  source_url: `${N}new`,
  ...o,
});

test("theme_catalysts: stored under the theme and served the same day by both endpoints", () => {
  const plan = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items: [item()] }, files(), ctx);
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  const added = plan.writes.externals.find((c) => c.ticker === "NBIS");
  assert.equal(added.catalyst_id, themeCatalystId("neocloud-us", "NBIS", "2027-02-28", "年末のARRが70億ドル以上"));
  const rec = { ...recOf(), externals: plan.writes.externals };
  const nbis = themeFullBody(findTheme(THEMES, "neocloud-us"), rec, SOLANA, TODAY).members.find((m) => m.ticker === "NBIS");
  assert.equal(nbis.current_catalyst.success_conditions[0].metric, "ARR at year-end 2026");
  assert.deepEqual(catalystFullBody("NBIS", rec, TODAY).themes, ["neocloud-us"]);
  assert.equal(catalystFreeBody("NBIS", rec, TODAY, "https://osd").researched, true);
});

test("theme_catalysts: a newer edition supersedes the older row; history rows record past editions as published", () => {
  const plan = planImport(
    {
      type: "theme_catalysts",
      author: "article",
      items: [
        item({ ticker: "LAMBDA", listed: false, company_name: "Lambda", question: "40億ドルの上場前調達を完了", supersedes: "ext_lam", target_date: "2026-12-31", date_confidence: "confirmed" }),
        item({ ticker: "CRWV", company_name: "CoreWeave", question: "大型の契約を公表", success_conditions: undefined, history: true, superseded_by: "ext_new1", target_date: "2026-09-30" }),
      ],
    },
    files(),
    ctx,
  );
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  const old = plan.writes.externals.find((c) => c.catalyst_id === "ext_lam");
  assert.equal(old.superseded_by, themeCatalystId("neocloud-us", "LAMBDA", "2026-12-31", "40億ドルの上場前調達を完了"));
  const hist = plan.writes.externals.find((c) => c.edition === "history" && c.catalyst_description === "大型の契約を公表【外れ方向】ARRガイダンスの引き下げ");
  assert.deepEqual([hist.superseded_by, hist.success_conditions], ["ext_new1", []]);
  // History is for articles only, and still needs a known replacement.
  const chat = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items: [item({ history: true, success_conditions: undefined })] }, files(), ctx);
  assert.match(chat.errors.join(), /history items come from articles/);
  const bad = planImport({ type: "theme_catalysts", author: "article", items: [item({ history: true, superseded_by: "ext_nope" })] }, files(), ctx);
  assert.match(bad.errors.join(), /superseded_by ext_nope is not on record/);
});

test("theme_catalysts: bad items are listed and skipped, a resend is a no-op", () => {
  const items = [
    item(),
    item({ ticker: "IREN", theme: "no-such-theme" }),
    item({ ticker: "HUT", question: "受注が堅調なら当たり", success_conditions: [] }),
    item({ ticker: "CIFR", source_url: "" }),
  ];
  const plan = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items }, files(), ctx);
  assert.equal(plan.applied, 1);
  const why = Object.fromEntries(plan.rejected.map((r) => [r.index, r.reasons.join(" / ")]));
  assert.match(why[1], /not in data\/themes\.json/);
  assert.match(why[2], /vague wording \(堅調\)/);
  assert.match(why[3], /source_url/);
  const again = planImport({ type: "theme_catalysts", author: CHAT_MODEL, items: [item()] }, { ...files(), externals: plan.writes.externals }, ctx);
  assert.match(again.errors.join(), /already on record/);
});

test("the chat export: E lists upcoming events, the renewal list (E-2) and the article verdicts (E-3)", () => {
  const r = recOf([
    ext({ catalyst_id: "ext_jul", ticker: "CIFR", market: "US", series: "neocloud-us", company_name: "Cipher Mining", catalyst_description: "Barber Lake 168MW を 9/30 までに納入", target_date: "2026-09-30", edition: "history", article_verdict: "未達" }),
  ]);
  const f = { ...files(), externals: r.externals, earnings: r.earnings, jpListed: r.jpListed };
  const { markdown, counts } = buildExport(f, { today: TODAY, since: null });
  assert.match(markdown, /### neocloud-us（米国 ネオクラウド）/);
  assert.match(markdown, /\| CRWV \| CoreWeave \| 2026-11-12 \|/);
  assert.match(markdown, /### E-2\. 条件の入れ替えが要る上場銘柄/);
  assert.match(markdown, /#### physical-ai-semis-us/);
  assert.match(markdown, /\| ext:ext_jul \| CIFR \| Cipher Mining \| 2026-09-30 \| 未達 \|/);
  assert.equal(counts.article_verdicts, 1);
});

// ── the committed data ────────────────────────────────────────────────────

const themes = JSON.parse(readFileSync("data/themes.json", "utf8"));
const externals = JSON.parse(readFileSync("data/external-catalysts.json", "utf8"));

test("committed themes: sector × market ids, no IR fair in any id or name, one latest edition each", () => {
  assert.deepEqual(themes.themes.map((t) => t.id).sort(), [
    "datacenter-power-jp", "edge-ai-field-dx-jp", "financials-jp", "food-staples-jp", "healthcare-jp",
    "infrastructure-resilience-jp", "mobility-auto-parts-jp", "neocloud-jp", "neocloud-us", "physical-ai-jp",
    "physical-ai-models-us", "physical-ai-robotics-us", "physical-ai-semis-us", "semiconductor-supply-chain-jp",
    "space-geospatial-jp", "weekly-jp", "weekly-us",
  ]);
  for (const t of themes.themes) {
    assert.doesNotMatch(JSON.stringify([t.id, t.title_ja, t.title_en, t.kind, t.members?.map((m) => m.group)]), /ir-fair|IR ?フェア|IR Fair/i, t.id);
    assert.equal(t.lineage.filter((a) => a.role === "latest").length, 1, t.id);
  }
  const size = (id) => themes.themes.find((t) => t.id === id).members.length;
  assert.deepEqual(
    ["neocloud-us", "neocloud-jp", "physical-ai-semis-us", "physical-ai-robotics-us", "physical-ai-models-us"].map(size),
    [18, 5, 10, 19, 8],
  );
  const pai = themes.themes.find((t) => t.id === "physical-ai-jp").members;
  assert.equal(pai.filter((m) => m.group !== "FA・部品").length, 20);
  assert.equal(pai.filter((m) => m.ticker === "6645").length, 1, "オムロン once");
  const hc = themes.themes.find((t) => t.id === "healthcare-jp").members.map((m) => m.ticker);
  assert.equal(new Set(hc).size, hc.length);
});

test("committed lineage: past editions kept with a status, nothing deleted, the scoreboard series unchanged", () => {
  const hist = externals.filter((c) => c.edition === "history");
  assert.equal(hist.length, 40);
  assert.equal(externals.filter((c) => c.article_verdict).length, 23);
  assert.equal(externals.filter((c) => c.ticker === "9449").length, 0);
  assert.equal(externals.filter((c) => c.series === "physical-ai").length, 89, "Physical AI hit-rate population unchanged");
  const byId = new Map(externals.map((c) => [c.catalyst_id, c]));
  for (const c of externals.filter((x) => x.superseded_by)) assert.ok(byId.has(c.superseded_by), c.catalyst_id);
  // Applied Intuition's 7/31 condition replaced the earlier one.
  assert.ok(byId.get("ext_88cd3fd3").superseded_by);
  // Companies an edition dropped stay on record but are not members.
  const { membersOf: mo } = { membersOf };
  const neo = mo(themes.themes.find((t) => t.id === "neocloud-us"), { usHistory: null, jpHistory: null, externals, jpListed: null });
  assert.equal(neo.length, 18);
  assert.ok(!neo.some((m) => ["NSCALE", "FLUIDSTACK"].includes(m.ticker)));
  const models = themes.themes.find((t) => t.id === "physical-ai-models-us").members.map((m) => m.ticker);
  for (const t of ["WAABI", "WAYVE", "GENESIS"]) assert.ok(!models.includes(t), t);
});
