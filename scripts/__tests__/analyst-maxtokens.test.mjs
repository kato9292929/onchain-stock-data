/**
 * /api/analyst max_tokens truncation fix.
 *
 * 1) Budgets are large enough to clear the observed ~6,700-7,000-char (≈4,500
 *    token) truncation point and stay within each model's output cap.
 * 2) The generator retries once when stop_reason === "max_tokens", and fails
 *    with invalid_output (not a JSON.parse of truncated text) if it still
 *    truncates. A successful (end_turn) response parses normally.
 *
 * The Anthropic SDK is stubbed via a temp node_modules shim so no network /
 * API key is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ── 1) Budget sanity (pure constants) ───────────────────────────────────
const gen = await import("../../lib/analyst/generator.ts");
const tmpl = await import("../../lib/analyst/templates.ts");

test("initial budgets clear the ~4,500-token truncation point", () => {
  // standard is what AA uses (route default); it was 4,500 and truncated.
  assert.ok(gen.MAX_TOKENS.standard >= 8_000, "standard budget raised");
  assert.ok(gen.MAX_TOKENS.quick >= 4_000);
  assert.ok(gen.MAX_TOKENS.deep >= 16_000);
});

test("retry ceilings exceed initial budgets and fit the model caps", () => {
  for (const depth of tmpl.DEPTHS) {
    assert.ok(
      gen.RETRY_MAX_TOKENS[depth] > gen.MAX_TOKENS[depth],
      `${depth} retry > initial`,
    );
    const model = tmpl.CLAUDE_MODEL[depth];
    const cap = gen.MODEL_OUTPUT_CAP[model];
    assert.ok(cap, `cap known for ${model}`);
    assert.ok(
      gen.RETRY_MAX_TOKENS[depth] <= cap,
      `${depth} retry ${gen.RETRY_MAX_TOKENS[depth]} <= ${model} cap ${cap}`,
    );
  }
});

// ── 2) Retry behaviour with a stubbed Anthropic SDK ─────────────────────
const VALID_REPORT = {
  ticker: "NVDA",
  company_name: "NVIDIA Corporation",
  generated_at: "2026-06-15T00:00:00Z",
  depth: "standard",
  verdict: "BUY",
  target_price_usd: 150,
  position_size_pct: 5,
  decision_card: { summary: "ok", key_metrics: { pe: "30" } },
  bull_case: "b",
  bear_case: "b",
  investment_thesis: [{ point: "p", supporting_data: "s" }],
  anti_thesis: [{ point: "p", supporting_data: "s" }],
  valuation: {
    method_1: { name: "DCF", value_usd: 150, assumptions: "a" },
    method_2: { name: "Comps", value_usd: 150, assumptions: "a" },
  },
  top_risks: [{ severity: 3, likelihood: 3, description: "d" }],
  decision_triggers: { upgrade_if: ["x"], downgrade_if: ["y"] },
  sources_called: [{ endpoint: "/api/stocks/NVDA", cost_usd: 0, data_summary: "d" }],
  total_cost_usd: 0,
  disclaimer: "not investment advice",
};

/**
 * Build a temp repo whose @anthropic-ai/sdk returns the given sequence of
 * { stop_reason, text } per messages.create() call, then import the generator
 * fresh from there and run it. Returns { result, calls }.
 */
async function runWithStub(sequence) {
  const dir = await mkdtemp(path.join(tmpdir(), "osd-analyst-"));
  await mkdir(path.join(dir, "lib", "analyst"), { recursive: true });
  // Copy the modules under test + their local deps.
  for (const f of ["generator.ts", "templates.ts", "data-aggregator.ts", "sec-edgar.ts"]) {
    await cp(path.join(REPO, "lib", "analyst", f), path.join(dir, "lib", "analyst", f));
  }
  await mkdir(path.join(dir, "lib"), { recursive: true });
  await cp(path.join(REPO, "lib", "data.ts"), path.join(dir, "lib", "data.ts")).catch(() => {});

  const stubDir = path.join(dir, "node_modules", "@anthropic-ai", "sdk");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    path.join(stubDir, "package.json"),
    JSON.stringify({ name: "@anthropic-ai/sdk", version: "0.0.0", type: "module", main: "index.mjs" }),
  );
  await writeFile(
    path.join(stubDir, "index.mjs"),
    `let i = 0;
     const seq = ${JSON.stringify(sequence)};
     export default class Anthropic {
       constructor() {
         globalThis.__calls = [];
         this.messages = { create: async (args) => {
           globalThis.__calls.push(args.max_tokens);
           const s = seq[Math.min(i, seq.length - 1)]; i++;
           return { stop_reason: s.stop_reason, content: [{ type: "text", text: s.text }] };
         } };
       }
     }\n`,
  );

  process.env.ANTHROPIC_API_KEY = "test-key";
  // tsx resolves the stub from the temp dir's node_modules via NODE_PATH.
  const mod = await import(
    path.join(dir, "lib", "analyst", "generator.ts") + `?t=${Date.now()}`
  );
  return mod;
}

test("retries once on max_tokens, succeeds when retry returns full JSON", async () => {
  const mod = await runWithStub([
    { stop_reason: "max_tokens", text: '{"ticker":"NVDA"' }, // truncated
    { stop_reason: "end_turn", text: JSON.stringify(VALID_REPORT) }, // full
  ]);
  globalThis.__calls = [];
  const res = await mod.generateAnalystReport({
    ticker: "NVDA",
    depth: "standard",
    aggregated: { stock_record: { price_usd: 150 }, fetch_endpoints: [] },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  // Two calls: first at initial budget, second (retry) at the higher ceiling.
  assert.equal(globalThis.__calls.length, 2);
  assert.ok(globalThis.__calls[1] > globalThis.__calls[0], "retry used higher max_tokens");
});

test("still max_tokens after retry → invalid_output, never parses truncated JSON", async () => {
  const mod = await runWithStub([
    { stop_reason: "max_tokens", text: '{"ticker":"NVDA"' },
    { stop_reason: "max_tokens", text: '{"ticker":"NVDA","company' },
  ]);
  const res = await mod.generateAnalystReport({
    ticker: "NVDA",
    depth: "standard",
    aggregated: { stock_record: { price_usd: 150 }, fetch_endpoints: [] },
  });
  assert.equal(res.ok, false);
  assert.equal(res.err.kind, "invalid_output");
  assert.match(res.err.message, /truncated|max_tokens/i);
});

test("no retry when first response completes (end_turn)", async () => {
  const mod = await runWithStub([
    { stop_reason: "end_turn", text: JSON.stringify(VALID_REPORT) },
  ]);
  globalThis.__calls = [];
  const res = await mod.generateAnalystReport({
    ticker: "NVDA",
    depth: "standard",
    aggregated: { stock_record: { price_usd: 150 }, fetch_endpoints: [] },
  });
  assert.equal(res.ok, true);
  assert.equal(globalThis.__calls.length, 1, "no retry needed");
});
