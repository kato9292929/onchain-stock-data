/**
 * resolveJpHoldings — universe-backed resolution that fixes the two JP bugs:
 *   bug1: corrupted tickers ("6ARETURN") must never reach holdings
 *   bug2: out-of-universe / "対象外" rows must be dropped, not kept
 * Pure function, no API key needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveJpHoldings,
  JP_UNIVERSE,
  JP_TICKER_RE,
  PORTFOLIO_SIZE,
} from "../../lib/jp-portfolio.ts";

const codes = new Set(JP_UNIVERSE.map((u) => u.code));
const nameByCode = new Map(JP_UNIVERSE.map((u) => [u.code, u.name]));

test("resolves a messy model response into exactly PORTFOLIO_SIZE clean holdings", () => {
  const raw = [
    // good rows (company_name deliberately wrong → must be resolved from universe)
    { ticker: "4062", company_name: "まちがった社名", weight: 12, thesis: "8/5決算で増収", target_date: "2026-08-05" },
    { ticker: "3110", company_name: "x", weight: 10, thesis: "増益", target_date: "2026-08-06" },
    { ticker: "6146", company_name: "x", weight: 10, thesis: "出荷増", target_date: "2026-07-24" },
    { ticker: "8035", company_name: "x", weight: 10, thesis: "受注増", target_date: "2026-08-12" },
    // bug1: corrupted ticker → dropped
    { ticker: "6ARETURN", company_name: "東京エレクトロン", weight: 10, thesis: "受注", target_date: "2026-08-12" },
    { ticker: "6ARETURN2", company_name: "ローツェ", weight: 8, thesis: "受注", target_date: "2026-08-07" },
    // bug2: out-of-universe (オリエンタルランド) → dropped
    { ticker: "4661", company_name: "オリエンタルランド", weight: 7, thesis: "対象外のため除外シグナル。", target_date: "" },
    // duplicate of 4062 → dropped
    { ticker: "4062", company_name: "x", weight: 5, thesis: "dup", target_date: "2026-08-05" },
  ];

  const out = resolveJpHoldings(raw);

  // exactly full
  assert.equal(out.length, PORTFOLIO_SIZE, "must be exactly 10");
  // all 4-digit and in-universe
  for (const h of out) {
    assert.match(h.ticker, JP_TICKER_RE, `ticker ${h.ticker} must be 4 digits`);
    assert.ok(codes.has(h.ticker), `ticker ${h.ticker} must be in universe`);
    assert.equal(h.company_name, nameByCode.get(h.ticker), "name resolved from universe");
  }
  // no corrupted tickers
  assert.ok(!out.some((h) => /ARETURN/.test(h.ticker)), "no 6ARETURN");
  // no out-of-universe / excluded rows
  assert.ok(!out.some((h) => h.ticker === "4661"), "no オリエンタルランド");
  assert.ok(!out.some((h) => /対象外|除外/.test(h.thesis)), "no excluded thesis");
  // no duplicates
  assert.equal(new Set(out.map((h) => h.ticker)).size, out.length, "no dup tickers");
  // weights sum to ~100
  const sum = out.reduce((s, h) => s + h.weight, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `weights sum ~100 (got ${sum})`);
  // the 4 real picks are kept with their resolved names
  assert.equal(out.find((h) => h.ticker === "4062")?.company_name, "イビデン");
});

test("a fully corrupted response still yields 10 in-universe holdings (filled)", () => {
  const raw = [
    { ticker: "6ARETURN", company_name: "x", weight: 50, thesis: "x" },
    { ticker: "ZZZZ", company_name: "x", weight: 50, thesis: "x" },
  ];
  const out = resolveJpHoldings(raw);
  assert.equal(out.length, PORTFOLIO_SIZE);
  for (const h of out) {
    assert.ok(codes.has(h.ticker), `${h.ticker} in universe`);
  }
});
