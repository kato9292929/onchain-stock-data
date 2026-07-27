/**
 * Tests for the portfolio weight normalization + hard single-name cap.
 * The cap is a risk control: no single holding exceeds MAX_HOLDING_WEIGHT even
 * if the model returns a concentrated book.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWeights,
  MAX_HOLDING_WEIGHT,
} from "../../lib/portfolio.ts";

const sum = (hs) => hs.reduce((s, h) => s + h.weight, 0);
const mk = (weights) =>
  weights.map((w, i) => ({
    ticker: `T${i}`,
    company_name: `c${i}`,
    weight: w,
    thesis: "",
    target_date: "",
  }));

test("10-name equal book scales to ~100, none over the cap", () => {
  const out = normalizeWeights(mk(Array(10).fill(1))); // -> 10% each
  assert.ok(Math.abs(sum(out) - 100) < 0.5);
  assert.ok(out.every((h) => h.weight <= MAX_HOLDING_WEIGHT + 1e-9));
});

test("caps a dominant name and still sums ~100 (10-name book)", () => {
  // One name at 60 raw among nine 8s: after scaling it is ~45%, must be capped
  // to 15 with the excess absorbed by the other nine → total stays ~100.
  const out = normalizeWeights(mk([60, 8, 8, 8, 8, 8, 8, 8, 8, 8]));
  const top = Math.max(...out.map((h) => h.weight));
  assert.ok(top <= MAX_HOLDING_WEIGHT + 1e-9, `top ${top} <= ${MAX_HOLDING_WEIGHT}`);
  assert.ok(Math.abs(sum(out) - 100) < 1);
});

test("no single name exceeds the cap even with several over-weight names", () => {
  const out = normalizeWeights(mk([40, 40, 30, 10, 10, 10, 10, 10, 10, 10]));
  assert.ok(out.every((h) => h.weight <= MAX_HOLDING_WEIGHT + 1e-9));
  assert.ok(Math.abs(sum(out) - 100) < 1); // 10 names, cap headroom 150 ≥ 100
});

test("drops invalid rows (zero/NaN/blank ticker)", () => {
  const out = normalizeWeights([
    { ticker: "A", company_name: "", weight: 10, thesis: "", target_date: "" },
    { ticker: "", company_name: "", weight: 10, thesis: "", target_date: "" },
    { ticker: "B", company_name: "", weight: 12, thesis: "", target_date: "" },
    { ticker: "C", company_name: "", weight: 0, thesis: "", target_date: "" },
    { ticker: "D", company_name: "", weight: NaN, thesis: "", target_date: "" },
  ]);
  assert.deepEqual(out.map((h) => h.ticker), ["A", "B"]); // C/D/blank dropped
});

test("empty / all-invalid input returns []", () => {
  assert.deepEqual(normalizeWeights([]), []);
  assert.deepEqual(normalizeWeights(mk([0, 0])), []);
});
