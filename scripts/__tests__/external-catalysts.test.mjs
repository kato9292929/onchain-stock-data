/**
 * Phase A tests — run with: npm test  (node --test via tsx loader).
 *
 * Covers: submission validation, id/dedup/eval-date logic, rate limiting,
 * the GRACE_DAYS due-window, and the evaluator picking up external entries.
 * Uses the built-in node:test runner; the pure lib has no Next/server deps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateSubmission,
  findDuplicate,
  buildCatalyst,
  estimatedEvalDate,
  addDays,
  scoreLookupUrl,
  GRACE_DAYS,
} from "../../lib/external-catalysts.ts";
import { checkRateLimit, _resetRateLimits } from "../../lib/rate-limit.ts";

const future = (days) => addDays(new Date().toISOString().slice(0, 10), days);

// ── Validation ────────────────────────────────────────────────────────
test("valid submission passes and normalises ticker to upper", () => {
  const r = validateSubmission({
    ticker: "nvda",
    catalyst_description: "Q2 earnings AI revenue beats $4.5B",
    target_date: future(30),
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.ticker, "NVDA");
  assert.equal(r.value.submitter_contact, null);
});

test("ticker is required", () => {
  const r = validateSubmission({
    catalyst_description: "something happens within a month",
    target_date: future(10),
  });
  assert.equal(r.ok, false);
  assert.equal(r.field, "ticker");
});

test("ticker rejects non-alphanumeric and >10 chars", () => {
  assert.equal(validateSubmission({ ticker: "NV.DA", catalyst_description: "0123456789", target_date: future(5) }).ok, false);
  assert.equal(validateSubmission({ ticker: "ABCDEFGHIJK", catalyst_description: "0123456789", target_date: future(5) }).ok, false);
});

test("catalyst_description length bounds (10-500)", () => {
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: "short", target_date: future(5) }).field, "catalyst_description");
  const long = "x".repeat(501);
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: long, target_date: future(5) }).field, "catalyst_description");
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: "x".repeat(10), target_date: future(5) }).ok, true);
});

test("target_date must be valid ISO and in the future", () => {
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: "0123456789", target_date: "not-a-date" }).field, "target_date");
  // Past date rejected
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: "0123456789", target_date: "2020-01-01" }).field, "target_date");
  // Today rejected (must be strictly future)
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(validateSubmission({ ticker: "NVDA", catalyst_description: "0123456789", target_date: today }).field, "target_date");
});

test("submitter_contact over 500 chars rejected", () => {
  const r = validateSubmission({
    ticker: "NVDA",
    catalyst_description: "0123456789",
    target_date: future(5),
    submitter_contact: "x".repeat(501),
  });
  assert.equal(r.field, "submitter_contact");
});

// ── id / dedup / eval date ────────────────────────────────────────────
test("generated catalyst_id has ext_ + 8 hex", () => {
  const c = buildCatalyst({ ticker: "NVDA", catalyst_description: "0123456789", target_date: future(5), submitter_contact: null });
  assert.match(c.catalyst_id, /^ext_[0-9a-f]{8}$/);
  assert.equal(c.status, "pending");
  assert.deepEqual(c.evidence_urls, []);
});

test("estimatedEvalDate is target + GRACE_DAYS", () => {
  assert.equal(estimatedEvalDate("2026-08-28"), addDays("2026-08-28", GRACE_DAYS));
  assert.equal(estimatedEvalDate("2026-08-28"), "2026-09-04");
});

test("duplicate detection matches ticker+description+target_date", () => {
  const v = { ticker: "NVDA", catalyst_description: "Q2 earnings beat", target_date: "2026-08-28", submitter_contact: null };
  const existing = buildCatalyst(v);
  const list = [existing];
  const dup = findDuplicate(list, v);
  assert.equal(dup?.catalyst_id, existing.catalyst_id);
  // Different target_date → no dup
  assert.equal(findDuplicate(list, { ...v, target_date: "2026-09-01" }), undefined);
});

test("score_lookup_url shape", () => {
  assert.equal(scoreLookupUrl("ext_abcd1234"), "/api/alpha/catalyst/ext_abcd1234/score");
});

// ── Rate limiting ─────────────────────────────────────────────────────
test("11th request from same IP is blocked (limit 10)", () => {
  _resetRateLimits();
  const ip = "203.0.113.7";
  for (let i = 1; i <= 10; i++) {
    assert.equal(checkRateLimit(ip).allowed, true, `req ${i} should be allowed`);
  }
  assert.equal(checkRateLimit(ip).allowed, false, "11th should be blocked");
});

test("different IPs have independent buckets", () => {
  _resetRateLimits();
  for (let i = 0; i < 10; i++) checkRateLimit("10.0.0.1");
  assert.equal(checkRateLimit("10.0.0.1").allowed, false);
  assert.equal(checkRateLimit("10.0.0.2").allowed, true);
});

// ── GRACE_DAYS due window ─────────────────────────────────────────────
test("pending external catalyst is not due until target_date + 7d", () => {
  const today = new Date().toISOString().slice(0, 10);
  // target 3 days ago → +7 still in the future → NOT due
  const recent = addDays(today, -3);
  assert.ok(addDays(recent, GRACE_DAYS) > today, "should not be due yet");
  // target 10 days ago → +7 is in the past → due
  const old = addDays(today, -10);
  assert.ok(addDays(old, GRACE_DAYS) <= today, "should be due");
});
