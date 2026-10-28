/**
 * What the scorer is asked to judge, and when it thinks "now" is.
 *
 * Two defects lived in one prompt, and both are visible in the record:
 *
 * 1. The folded `成立条件【外れ方向】外れシナリオ` string was handed over whole
 *    under the label `success_condition:`. The model duly judged the fail
 *    clause — ext_e5d99360's own reasoning reads 「submitterの【外れ方向】
 *    success_condition…は満たされておらず、miss判定」 — so QCOM's automotive
 *    growing +61% against a ~+50% condition was recorded a miss.
 *
 * 2. The only date in the prompt was `週: <選定週>`, which reads as today.
 *    3110 was judged on 2026-08-13 and concluded 「現在の週は2026-06-29であり…
 *    約5週間先」 about a 短信 published eight days earlier. Seven `na`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { splitCondition } = await import("../evaluate-catalysts.mjs");
const SRC = readFileSync("scripts/evaluate-catalysts.mjs", "utf8");

test("importing the scorer does not start a billed run", () => {
  // The import above would have spent money before this file's first assertion.
  assert.equal(typeof splitCondition, "function");
  assert.match(SRC, /invokedDirectly/, "entry guard must stay");
});

test("the two halves are separated", () => {
  const { success, failDirection } = splitCondition(
    "Q3 FY2026決算で、QCT自動車が会社ガイダンスの前年同期比約+50%成長を達成する" +
      "【外れ方向】自動車の伸び鈍化。メモリ市況の影響がハンドセット以外へ波及する場合",
  );
  assert.equal(
    success,
    "Q3 FY2026決算で、QCT自動車が会社ガイダンスの前年同期比約+50%成長を達成する",
  );
  assert.match(failDirection, /自動車の伸び鈍化/);
  assert.doesNotMatch(success, /外れ方向|鈍化/, "the fail clause must not leak in");
});

test("a condition with no marker is passed through whole", () => {
  const { success, failDirection } = splitCondition("営業利益が会社計画を上回る");
  assert.equal(success, "営業利益が会社計画を上回る");
  assert.equal(failDirection, null);
});

test("empty and missing input do not throw", () => {
  assert.deepEqual(splitCondition(null), { success: "", failDirection: null });
  assert.deepEqual(splitCondition("条件【外れ方向】"), {
    success: "条件",
    failDirection: null,
  });
});

test("the prompt names success_condition as the only thing judged", () => {
  assert.match(SRC, /success_condition: \$\{success\}/, "the split half is sent");
  assert.match(SRC, /これは判定対象ではない/, "fail_direction is marked non-judgeable");
  assert.match(
    SRC,
    /fail_direction は背景情報であり、その成否を判定してはいけません/,
    "and said again in the instruction line",
  );
  assert.doesNotMatch(
    SRC,
    /success_condition: \$\{condition\}/,
    "the folded string must never be labelled success_condition again",
  );
});

test("the prompt states the evaluation date, and the week is not 'now'", () => {
  assert.match(SRC, /本日（判定実施日）: \$\{today\}/, "today comes first");
  assert.match(SRC, /本日より過去。すでに到来済みの日付として扱うこと/);
  assert.doesNotMatch(
    SRC,
    /context: `週: \$\{entry\.week_of\}/,
    "a bare 週: reads as today — it caused seven premature na verdicts",
  );
  assert.equal(
    (SRC.match(/asOf: todayIso\(\)/g) ?? []).length,
    3,
    "all three call sites must pass the evaluation date",
  );
});

test("the split matches lib/physical-ai-scoreboard.ts, which cannot be imported here", () => {
  // The scorer runs under plain `node` and cannot load a .ts module, so the
  // marker is duplicated. Pin the copies to each other.
  const ts = readFileSync("lib/physical-ai-scoreboard.ts", "utf8");
  assert.match(ts, /const marker = "【外れ方向】"/);
  // The scorer's copy now lives in scripts/lib/chat-ops.mjs, shared with the
  // chat export/import.
  assert.match(readFileSync("scripts/lib/chat-ops.mjs", "utf8"), /const marker = "【外れ方向】"/);
  assert.match(SRC, /import \{ splitCondition \} from "\.\/lib\/chat-ops\.mjs"/);
});
