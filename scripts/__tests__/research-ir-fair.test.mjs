/**
 * scripts/research-ir-fair.mjs is a cost action: every company it researches
 * is a Claude call plus billed web searches. These tests pin the parts that
 * decide what gets spent and what the output is allowed to claim — all of
 * them pure, so importing the module must not start a run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../research-ir-fair.mjs");
const { parsePlan, selectCompanies, systemPromptFor, costOf, RATES } = mod;
const { SECTORS } = await import("../../lib/catalyst-sectors.ts");

const section = (slug) => SECTORS.find((s) => s.slug === slug);

const FILE = {
  catalysts: [
    { ticker: "1807", sector: "建設業", stage: "draft" },
    { ticker: "1938", sector: "建設業", stage: "draft" },
    { ticker: "1964", sector: "建設業", stage: "draft" },
    { ticker: "6339", sector: "機械", stage: "active" },
    { ticker: "2009", sector: "食料品", stage: "draft" },
    { ticker: "2819", sector: "食料品", stage: "review" },
  ],
};

test("importing the script does not run it", () => {
  // If main() fired on import, it would have exited on the missing --plan.
  assert.equal(typeof parsePlan, "function");
});

test("a plan selects only drafts, per sector, up to its count", () => {
  const picked = selectCompanies(FILE, parsePlan("infrastructure:2,domestic-defensive:5"));

  assert.deepEqual(
    picked.map((p) => p.ticker ?? p.company.ticker),
    ["1807", "1938", "2009"],
    "two of three 建設業 drafts, and the one 食料品 draft",
  );
  assert.ok(
    !picked.some((p) => p.company.ticker === "6339"),
    "an already-researched company is never re-billed",
  );
  assert.ok(
    !picked.some((p) => p.company.ticker === "2819"),
    "a company awaiting review is not researched again either",
  );
});

test("a bad plan is rejected before anything is spent", () => {
  assert.throws(() => parsePlan("infrastructure"), /slug:count/);
  assert.throws(() => parsePlan("infrastructure:0"), /slug:count/);
  assert.throws(() => parsePlan("no-such-sector:3"), /unknown sector/);
});

test("Earnings sectors demand the baseline number inside the condition", () => {
  const earnings = systemPromptFor(section("domestic-defensive"));
  const policy = systemPromptFor(section("infrastructure"));

  assert.match(earnings, /基準値を必ず条件文に書く/);
  assert.match(earnings, /出典/, "and where the baseline came from");
  assert.doesNotMatch(
    policy,
    /基準値を必ず条件文に書く/,
    "a Policy sector has no guidance figure to compare against",
  );
});

test("every sector is told to keep conditions falsifiable", () => {
  // The whole point of the track record. A condition that cannot fail — "the
  // results are announced", "revenue grows" — inflates the hit rate silently.
  for (const slug of ["infrastructure", "domestic-defensive", "mobility"]) {
    const prompt = systemPromptFor(section(slug));
    assert.match(prompt, /上振れ／下振れのどちらもあり得る水準/, slug);
    assert.match(prompt, /決算が発表される/, `${slug}: names the banned shape`);
    assert.match(prompt, /未達（ミス）/, `${slug}: silence is a miss`);
  }
});

test("financial figures are optional, and never invented", () => {
  const prompt = systemPromptFor(section("infrastructure"));
  assert.match(prompt, /確認できなければ null のまま/);
  assert.match(prompt, /財務値が無いことは昇格の妨げにならない/);
  assert.match(prompt, /EDINET の財務数値抽出は使わない/);
});

test("cost is computed from the published rates", () => {
  // 1M input, 1M output, 1M cache read, 100 searches.
  const cost = costOf({
    input_tokens: 1e6,
    output_tokens: 1e6,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1e6,
    web_search_requests: 100,
  });
  const expected =
    RATES.input_per_mtok + RATES.output_per_mtok + RATES.cache_read_per_mtok + 100 * RATES.per_search;
  assert.equal(Number(cost.toFixed(6)), Number(expected.toFixed(6)));
  assert.equal(RATES.per_search, 0.01, "$10 per 1,000 searches");
});

test("billing and auth failures stop the run, transient ones do not", () => {
  // 2026-09-23: "credit balance is too low" arrived on the last company. On an
  // earlier one, every company after it would have paid a request to rediscover it.
  const { isFatalRunError } = mod;
  assert.ok(isFatalRunError(new Error("400 Your credit balance is too low to access the Anthropic API")));
  assert.ok(isFatalRunError(Object.assign(new Error("nope"), { status: 401 })));
  assert.ok(!isFatalRunError(new Error("Request timed out.")), "one slow company is not the whole run");
  assert.ok(!isFatalRunError(new Error("no JSON object in response")));
});
