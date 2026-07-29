/**
 * Tests for the external signals layer: the judgeability derivation, the
 * scoring gate (only judgeable + verified enter hit-rate), and the prompt
 * formatting (grouped by direction, unverified/non-judgeable tagged).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeabilityOf,
  isScorable,
  scorableSignals,
  formatSignalsForPrompt,
} from "../../lib/signals.ts";

const base = {
  id: "x",
  claim: "c",
  direction: "bearish",
  scope: "AI-infra",
  source: "s",
  source_tier: "secondary",
  verified: true,
};

test("judgeabilityOf: date + threshold → judgeable", () => {
  assert.equal(
    judgeabilityOf({ ...base, target_date: "2026-08-01", threshold: "x>1" }),
    "judgeable",
  );
});

test("judgeabilityOf: observable + threshold → judgeable", () => {
  assert.equal(
    judgeabilityOf({ ...base, observable: "spread bps", threshold: ">200" }),
    "judgeable",
  );
});

test("judgeabilityOf: only one of anchor/threshold → conditionable", () => {
  assert.equal(judgeabilityOf({ ...base, threshold: ">200" }), "conditionable");
  assert.equal(judgeabilityOf({ ...base, target_date: "2026-08-01" }), "conditionable");
});

test("judgeabilityOf: no anchor, no threshold → context", () => {
  assert.equal(judgeabilityOf({ ...base }), "context");
});

test("judgeabilityOf: explicit override wins", () => {
  assert.equal(
    judgeabilityOf({ ...base, target_date: "2026-08-01", threshold: "x", judgeability: "context" }),
    "context",
  );
});

test("isScorable: only judgeable AND verified", () => {
  const judgeable = { ...base, observable: "s", threshold: "t" };
  assert.equal(isScorable({ ...judgeable, verified: true }), true);
  assert.equal(isScorable({ ...judgeable, verified: false }), false); // unverified excluded
  assert.equal(isScorable({ ...base, verified: true }), false); // context excluded
});

test("scorableSignals: filters to the hit-rate-eligible subset", () => {
  const signals = [
    { ...base, id: "a", observable: "s", threshold: "t", verified: true }, // in
    { ...base, id: "b", observable: "s", threshold: "t", verified: false }, // unverified
    { ...base, id: "c", verified: true }, // context
    { ...base, id: "d", threshold: "t", verified: true }, // conditionable
  ];
  assert.deepEqual(scorableSignals(signals).map((s) => s.id), ["a"]);
});

test("formatSignalsForPrompt: groups by direction, tags unverified/参考, empty→''", () => {
  assert.equal(formatSignalsForPrompt(null), "");
  assert.equal(formatSignalsForPrompt({ signals: [] }), "");
  const out = formatSignalsForPrompt({
    signals: [
      { ...base, id: "a", direction: "bullish", claim: "up", observable: "o", threshold: "t", verified: true },
      { ...base, id: "b", direction: "bearish", claim: "down", verified: false },
    ],
  });
  assert.match(out, /強気/);
  assert.match(out, /弱気/);
  assert.match(out, /採点対象ではない/);
  // bearish context + unverified → both tags present
  assert.match(out, /down.*未検証・参考/);
  // bullish judgeable + verified → no tag
  assert.ok(/up(?!.*\[)/.test(out.split("\n").find((l) => l.includes("up"))));
});
