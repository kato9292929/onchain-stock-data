/**
 * An unverified claim must not reach the selection prompt at all.
 *
 * It used to go in with a 「未検証」 tag and an instruction to discount it.
 * That did not survive contact with the output: `sig_nvda_circular_financing`
 * — verified false, sourced to an X post relaying WSJ, amounts unconfirmed —
 * came back in eight weeks of published `rationale` as 「循環取引疑惑を踏まえ」,
 * a flat assertion with no hedge and no source. A label the model may ignore
 * is not a control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { formatSignalsForPrompt, selectableSignals, VERIFIED_ONLY_FROM } =
  await import("../../lib/signals.ts");

const file = (signals) => ({ signals });
const sig = (o) => ({
  id: "sig_x",
  scope: "macro",
  claim: "c",
  direction: "bearish",
  verified: true,
  ...o,
});

test("an unverified signal is withheld and named", () => {
  const { kept, droppedIds } = selectableSignals(
    file([sig({ id: "keep" }), sig({ id: "drop", verified: false })]),
  );
  assert.deepEqual(kept.map((s) => s.id), ["keep"]);
  assert.deepEqual(droppedIds, ["drop"], "the id must be reportable");
});

test("its text never appears in the prompt body", () => {
  const body = formatSignalsForPrompt(
    file([sig({ id: "drop", verified: false, claim: "循環取引の疑い" })]),
  );
  assert.doesNotMatch(body, /循環取引/);
  assert.equal(body, "", "nothing verified left — no section at all");
});

test("the live signals file no longer leaks the circular-trading claim", () => {
  const live = JSON.parse(readFileSync("data/signals.json", "utf8"));
  const body = formatSignalsForPrompt(live);
  assert.doesNotMatch(body, /循環取引/, "the claim that reached 8 weeks of rationale");

  const { droppedIds } = selectableSignals(live);
  assert.ok(droppedIds.includes("sig_nvda_circular_financing"));
  // The verified credit-spread signal is a different matter and still goes in.
  assert.match(body, /社債スプレッド/, "a verified claim is not collateral damage");
});

test("signals.json itself is untouched by the gate", () => {
  // Scoring and other callers read the same file; this is a decision about one
  // prompt, not about the record.
  const live = JSON.parse(readFileSync("data/signals.json", "utf8"));
  assert.ok(
    live.signals.some((s) => s.verified === false),
    "unverified rows must still exist on disk",
  );
});

test("the change is dated, so a week's inputs can be read back", () => {
  assert.match(VERIFIED_ONLY_FROM, /^\d{4}-\d{2}-\d{2}$/);
  const src = readFileSync("lib/jobs.ts", "utf8");
  assert.match(src, /withheld \$\{droppedIds\.length\} unverified signal/);
  assert.match(src, /VERIFIED_ONLY_FROM/, "the run log states the cutoff");
});

test("the prompt no longer promises a 未検証 tag it can never show", () => {
  const body = formatSignalsForPrompt(
    file([sig({ id: "a", claim: "検証済みの主張" })]),
  );
  assert.match(body, /未検証のシグナルは渡していない/);
  assert.doesNotMatch(body, /\[未検証/, "no row can carry that tag any more");
});
