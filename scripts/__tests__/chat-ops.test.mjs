/**
 * The chat operation (2026-10-28): export → chat → import.
 * Fixtures are small and synthetic; one test reads the live files only to
 * check the export's invariants, never exact counts that judging will change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, loadFiles, mondayOf } from "../export-for-chat.mjs";
import { planImport, EMPTY_ERAS } from "../import-from-chat.mjs";
import { CHAT_MODEL, collectRows, judgeableFrom, parseRowId } from "../lib/chat-ops.mjs";
import { selectionEra, splitByEra } from "../../lib/operation-era.ts";

const NOW = "2026-10-28T03:00:00.000Z";
const ctx = (extra = {}) => ({
  now: NOW,
  today: "2026-10-28",
  listed: { as_of: "2026-09-30", listed: { 8035: { name: "東京エレクトロン" }, 6857: { name: "アドバンテスト" }, 6146: { name: "ディスコ" } } },
  ...extra,
});

function fixture() {
  return {
    usHistory: {
      current: {
        week_of: "2026-10-12",
        model: "claude-sonnet-5",
        holdings: [
          { ticker: "JPM", company_name: "JPMorgan", weight: 50, thesis: "NII 上方修正", target_date: "2026-10-14" },
          { ticker: "MSFT", company_name: "Microsoft", weight: 50, thesis: "Azure +35%", target_date: "2026-10-28" },
        ],
      },
      history: [],
    },
    usEvals: {
      evaluations: [
        { week_of: "2026-10-12", ticker: "JPM", catalyst_target_date: "2026-10-14", success_condition: "NII 上方修正", condition_source: "thesis", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null },
        { week_of: "2026-10-12", ticker: "MSFT", catalyst_target_date: "2026-10-28", success_condition: "Azure +35%", condition_source: "thesis", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null },
      ],
    },
    jpHistory: {
      current: {
        week_of: "2026-10-12",
        model: "claude-sonnet-5",
        holdings: [
          { ticker: "6146", company_name: "ディスコ", weight: 60, thesis: "受注増", target_date: "2026-10-15" },
          { ticker: "8035", company_name: "東京エレクトロン", weight: 40, thesis: "装置売上+20%", target_date: "2026-10-29", target_date_source: "verified", target_date_confirmed: "2026-10-30", target_date_confirmed_source: "https://www.tel.co.jp/ir/", target_date_checked_at: "2026-10-17" },
        ],
      },
      history: [],
    },
    jpEvals: {
      evaluations: [
        { week_of: "2026-10-12", ticker: "6146", catalyst_target_date: "2026-10-15", success_condition: "受注増", status: "hit", evaluated_at: "2026-10-22T00:00:00Z", evidence_url: "https://www.disco.co.jp/a", reasoning: "old" },
        { week_of: "2026-10-12", ticker: "8035", catalyst_target_date: "2026-10-29", success_condition: "装置売上+20%", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null },
      ],
    },
    externals: [
      { catalyst_id: "ext_1", ticker: "QCOM", catalyst_description: "自動車+50%【外れ方向】伸び鈍化", target_date: "2026-10-01", status: "pending", evidence_urls: [], judgement_date: null, reasoning: null },
    ],
    irFair: { catalysts: [{ catalyst_id: "irf_1", ticker: "7203", stage: "draft", due_date: "2026-10-01", status: "pending" }] },
    signals: { signals: [{ id: "sig_old", claim: "c", source: "x", source_tier: "opinion", verified: false, added_at: "2026-07-27T00:00:00Z" }] },
    eras: structuredClone(EMPTY_ERAS),
  };
}

const verdict = (id, extra = {}) => ({
  id,
  status: "hit",
  reasoning: "Q3 で NII 見通しを引き上げた",
  evidence_url: "https://www.jpmorganchase.com/ir/quarterly-earnings",
  evaluated_at: NOW,
  evaluator: CHAT_MODEL,
  ...extra,
});

// ── ids & export ──────────────────────────────────────────────────────────

test("row ids round-trip", () => {
  assert.deepEqual(parseRowId("us:2026-10-12:JPM"), { kind: "us", week_of: "2026-10-12", ticker: "JPM" });
  assert.deepEqual(parseRowId("jp:2026-10-19:593A"), { kind: "jp", week_of: "2026-10-19", ticker: "593A" });
  assert.deepEqual(parseRowId("ext:ext_1"), { kind: "ext", catalyst_id: "ext_1" });
  assert.equal(parseRowId("nope"), null);
});

test("A lists pending rows past max(target, confirmed)+7 and nothing else", () => {
  const { due, markdown } = buildExport(fixture(), { today: "2026-10-28", since: null });
  // JPM (10-14) and the external (10-01) are due; MSFT is not yet; 6146 is
  // judged; 8035 waits for its confirmed 10-30; draft IR rows are not scored.
  assert.deepEqual(due.map((r) => r.id).sort(), ["ext:ext_1", "us:2026-10-12:JPM"]);
  assert.match(markdown, /## A\. 判定待ち（2件）/);
  // The fail direction is split out and labelled, never merged into the condition.
  assert.match(markdown, /- success_condition: 自動車\+50%\n- fail_direction: 伸び鈍化/);
});

test("C marks unverified signals, and counts only those since the last export", () => {
  const f = fixture();
  assert.match(buildExport(f, { today: "2026-10-28", since: null }).markdown, /\| sig_old \| 未検証 \|/);
  assert.equal(buildExport(f, { today: "2026-10-28", since: "2026-10-01" }).counts.signals, 0);
  assert.equal(buildExport(f, { today: "2026-10-28", since: "2026-07-27" }).counts.signals, 1, "same-day additions count");
});

test("D groups unchecked deadlines by disclosure and leaves verified ones out", () => {
  const { markdown, counts } = buildExport(fixture(), { today: "2026-10-28", since: null });
  assert.equal(counts.unchecked, 2); // JPM, MSFT — 8035 is verified, 6146 is judged
  assert.doesNotMatch(markdown.split("## D.")[1], /8035/);
});

test("B says when the latest week is not this week's", () => {
  const { markdown } = buildExport(fixture(), { today: "2026-10-28", since: null });
  assert.match(markdown, /以後の週（2026-10-19、2026-10-26）は未選定/);
  assert.equal(mondayOf("2026-10-28"), "2026-10-26");
});

test("the live export only ever lists judgeable pending rows", async () => {
  const files = await loadFiles();
  const today = "2026-10-28";
  const { due } = buildExport(files, { today, since: null });
  for (const r of due) {
    assert.equal(r.status, "pending", r.id);
    assert.ok(judgeableFrom(r.target_date, r.target_date_confirmed) <= today, r.id);
  }
  const ids = collectRows(files).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "row ids must be unique");
});

// ── verdicts ──────────────────────────────────────────────────────────────

test("a verdict without an evidence URL is not imported", () => {
  const plan = planImport({ type: "verdicts", items: [verdict("us:2026-10-12:JPM", { evidence_url: "" })] }, fixture(), ctx());
  assert.equal(plan.applied, 0);
  assert.match(plan.rejected[0].reasons.join(), /evidence_url is required/);
});

test("unknown ids, early verdicts and the wrong evaluator are rejected", () => {
  const plan = planImport(
    {
      type: "verdicts",
      items: [
        verdict("us:2026-10-12:XOM"),
        verdict("us:2026-10-12:MSFT"), // judgeable from 11-04
        verdict("jp:2026-10-12:8035"), // confirmed 10-30 → from 11-06
        verdict("ext:ext_1", { evaluator: "claude-sonnet-5" }),
      ],
    },
    fixture(),
    ctx(),
  );
  assert.equal(plan.applied, 0);
  assert.match(plan.rejected[0].reasons.join(), /unknown id/);
  assert.match(plan.rejected[1].reasons.join(), /too early: judgeable from 2026-11-04/);
  assert.match(plan.rejected[2].reasons.join(), /too early: judgeable from 2026-11-06/);
  assert.match(plan.rejected[3].reasons.join(), /evaluator must be/);
});

test("a pending row takes the verdict and records who judged it", () => {
  const f = fixture();
  const plan = planImport({ type: "verdicts", items: [verdict("us:2026-10-12:JPM"), verdict("ext:ext_1", { status: "miss" })] }, f, ctx());
  assert.equal(plan.applied, 2);
  const row = plan.writes.usEvals.evaluations.find((e) => e.ticker === "JPM");
  assert.equal(row.status, "hit");
  assert.equal(row.evaluator, CHAT_MODEL);
  assert.equal(row.evidence_url, "https://www.jpmorganchase.com/ir/quarterly-earnings");
  assert.equal(row.verdict_history, undefined, "pending carries nothing worth keeping");
  const ext = plan.writes.externals.find((e) => e.catalyst_id === "ext_1");
  assert.deepEqual(ext.evidence_urls, ["https://www.jpmorganchase.com/ir/quarterly-earnings"]);
  assert.equal(ext.judgement_date, "2026-10-28");
  // Inputs are not mutated: a rejected import must leave nothing half-applied.
  assert.equal(f.usEvals.evaluations[0].status, "pending");
  assert.equal(plan.writes.eras.verdicts_chat_from, "2026-10-28");
});

test("a judged row is never overwritten; re-judging keeps the old verdict", () => {
  const f = fixture();
  const bare = planImport({ type: "verdicts", items: [verdict("jp:2026-10-12:6146", { status: "miss" })] }, f, ctx());
  assert.equal(bare.applied, 0);
  assert.match(bare.rejected[0].reasons.join(), /already judged \(hit\); re-judging needs revision_reason/);

  const revised = planImport(
    { type: "verdicts", items: [verdict("jp:2026-10-12:6146", { status: "miss", revision_reason: "受注は前年割れだった" })] },
    f,
    ctx(),
  );
  const row = revised.writes.jpEvals.evaluations.find((e) => e.ticker === "6146");
  assert.equal(row.status, "miss");
  assert.equal(row.verdict_history.length, 1);
  assert.equal(row.verdict_history[0].status, "hit");
  assert.equal(row.verdict_history[0].reasoning, "old");
  assert.equal(row.verdict_history[0].change_reason, "受注は前年割れだった");
});

// ── selection ─────────────────────────────────────────────────────────────

const selection = (extra = {}) => ({
  type: "selection",
  market: "JP",
  week_of: "2026-10-26",
  model: CHAT_MODEL,
  rationale: "AI 装置の決算週",
  used_external_data: false,
  holdings: [
    { ticker: "8035", company_name: "東京エレクトロン", weight: 40, thesis: "装置売上+20%", target_date: "2026-10-30", target_date_source: "verified", target_date_source_url: "https://www.tel.co.jp/ir/" },
    { ticker: "6857", company_name: "アドバンテスト", weight: 40, thesis: "HBM テスタ受注増", target_date: "2026-10-28", target_date_source: "model" },
    { ticker: "6967", company_name: "新光電気工業", weight: 20, thesis: "基板", target_date: "2026-10-31", target_date_source: "model" },
  ],
  ...extra,
});

test("a JP selection passes the listing screen before it is recorded", () => {
  const plan = planImport(selection(), fixture(), ctx());
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  const cur = plan.writes.jpHistory.current;
  assert.equal(cur.model, CHAT_MODEL);
  assert.deepEqual(cur.holdings.map((h) => h.ticker), ["8035", "6857"]);
  assert.equal(cur.holdings.reduce((n, h) => n + h.weight, 0), 100);
  assert.equal(cur.excluded_holdings[0].ticker, "6967");
  assert.equal(cur.excluded_holdings[0].original_weight, 20);
  assert.equal(cur.holdings[0].target_date_confirmed_source, "https://www.tel.co.jp/ir/");
  assert.equal(plan.writes.jpHistory.history[0].week_of, "2026-10-12", "the old current rotates into history");
  // Registered as pending at once — there is no evaluator run to do it later.
  const fresh = plan.writes.jpEvals.evaluations.filter((e) => e.week_of === "2026-10-26");
  assert.deepEqual(fresh.map((e) => e.status), ["pending", "pending"]);
  assert.equal(plan.writes.eras.selection_chat_from.JP, "2026-10-26");
  assert.equal(plan.writes.eras.selection_chat_from.US, null);
});

test("a selection is refused whole when it breaks a rule", () => {
  const f = fixture();
  assert.match(planImport(selection({ week_of: "2026-10-12" }), f, ctx()).errors.join(), /already on record/);
  assert.match(planImport(selection({ week_of: "2026-10-27" }), f, ctx()).errors.join(), /Monday/);
  assert.match(planImport(selection({ model: "claude-sonnet-5" }), f, ctx()).errors.join(), /model must be/);
  const bad = selection();
  bad.holdings[0].weight = 10;
  assert.match(planImport(bad, f, ctx()).errors.join(), /weights sum to 70/);
  const noUrl = selection();
  delete noUrl.holdings[0].target_date_source_url;
  assert.match(planImport(noUrl, f, ctx()).errors.join(), /verified target_date needs target_date_source_url/);
  const us = {
    ...selection({ market: "US" }),
    holdings: [
      { ticker: "MSFT", company_name: "Microsoft", weight: 60, thesis: "x", target_date: "2026-10-28", target_date_source: "model" },
      { ticker: "JPM", company_name: "JPMorgan", weight: 40, thesis: "y", target_date: "2027-01-14", target_date_source: "model" },
    ],
  };
  assert.match(planImport(us, f, ctx()).errors.join(), /exceeds the US cap of 15/);
});

test("the switch-over week is recorded once and never moved", () => {
  const f = fixture();
  f.eras.selection_chat_from.JP = "2026-10-26";
  f.jpHistory.current.week_of = "2026-10-26";
  const next = selection({ week_of: "2026-11-02" });
  for (const h of next.holdings) h.target_date = "2026-11-10";
  const plan = planImport(next, f, ctx());
  assert.equal(plan.errors, undefined, JSON.stringify(plan.errors));
  assert.equal(plan.writes.eras.selection_chat_from.JP, "2026-10-26");
});

test("weeks split into api and chat populations at the recorded week", () => {
  const eras = { selection_chat_from: { US: null, JP: "2026-10-26" }, verdicts_chat_from: null };
  assert.equal(selectionEra("JP", "2026-10-19", eras), "api");
  assert.equal(selectionEra("JP", "2026-10-26", eras), "chat");
  assert.equal(selectionEra("US", "2026-11-02", eras), "api");
  const split = splitByEra([{ week_of: "2026-10-19" }, { week_of: "2026-11-02" }], "JP", eras);
  assert.equal(split.api.length, 1);
  assert.equal(split.chat.length, 1);
});

// ── signals & date checks ─────────────────────────────────────────────────

test("signals need a source URL; unverified ones are kept and marked", () => {
  const f = fixture();
  const plan = planImport(
    {
      type: "signals",
      items: [
        { claim: "HBM 価格が上昇", source_url: "https://example.com/a", source_tier: "secondary", verified: false, tickers: ["6857"], observed_at: "2026-10-27" },
        { claim: "URL なし", source_tier: "opinion", verified: false, tickers: [], observed_at: "2026-10-27" },
      ],
    },
    f,
    ctx(),
  );
  assert.equal(plan.applied, 1);
  assert.match(plan.rejected[0].reasons.join(), /source_url is required/);
  const added = plan.writes.signals.signals.at(-1);
  assert.equal(added.verified, false);
  assert.equal(added.judgeability, "context");
  assert.equal(added.added_by, CHAT_MODEL);
  f.signals = plan.writes.signals;
  const { markdown } = buildExport(f, { today: "2026-10-29", since: "2026-10-28" });
  assert.match(markdown, new RegExp(`\\| ${added.id} \\| 未検証 \\| HBM 価格が上昇`));
});

test("a date check records the company's date beside the deadline, never over it", () => {
  const plan = planImport(
    { type: "date_checks", items: [{ ids: ["us:2026-10-12:MSFT"], confirmed_date: "2026-10-29", source_url: "https://www.microsoft.com/en-us/investor" }] },
    fixture(),
    ctx(),
  );
  assert.equal(plan.applied, 1);
  const h = plan.writes.usHistory.current.holdings.find((x) => x.ticker === "MSFT");
  assert.equal(h.target_date, "2026-10-28");
  assert.equal(h.target_date_confirmed, "2026-10-29");
  assert.equal(h.target_date_source, "verified");
  assert.equal(h.target_date_checked_at, "2026-10-28");
});

test("an unknown type writes nothing", () => {
  assert.ok(planImport({ type: "prices" }, fixture(), ctx()).errors);
});
