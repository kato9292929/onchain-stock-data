/**
 * /api/catalyst/{ticker} must not charge for a response with nothing in it.
 *
 * 184 of the 197 IR-Fair companies are still at stage "draft": due_date,
 * success_condition, fail_condition and source are all null, and the only
 * populated fields (name, sector, market) are already given away by the free
 * /api/catalyst index. Issuing a 402 for those would sell an empty answer. An
 * unknown ticker should not reach the paywall either — the buyer would sign
 * and only then be told it does not exist.
 *
 * Tests the policy (lib/catalyst-access.ts) rather than the route, so nothing
 * here constructs a paywall or reaches for a facilitator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { classifyCatalystAccess } = await import("../../lib/catalyst-access.ts");
const { getIrFairFile } = await import("../../lib/ir-fair-scoreboard.ts");

const IR = [
  { ticker: "6339", stage: "active" },
  { ticker: "1807", stage: "draft" },
];
const PHYSICAL_AI = [{ ticker: "NVDA" }];

test("a researched company is the paid surface", () => {
  assert.equal(classifyCatalystAccess("6339", IR, PHYSICAL_AI), "paid");
});

test("a covered but un-researched company is free", () => {
  assert.equal(classifyCatalystAccess("1807", IR, PHYSICAL_AI), "free-draft");
});

test("a Physical-AI series catalyst is paid even outside IR-Fair", () => {
  assert.equal(classifyCatalystAccess("nvda", IR, PHYSICAL_AI), "paid");
});

test("an unknown ticker is not found, so it never reaches the paywall", () => {
  assert.equal(classifyCatalystAccess("ZZZZ9999", IR, PHYSICAL_AI), "not-found");
});

test("a draft row that is also a Physical-AI catalyst stays paid", () => {
  // The series carries a dated condition even when the IR-Fair row is empty.
  const ir = [{ ticker: "1807", stage: "draft" }];
  assert.equal(classifyCatalystAccess("1807", ir, [{ ticker: "1807" }]), "paid");
});

test("against the real dataset, the draft majority is free", async () => {
  const ir = await getIrFairFile();
  const drafts = ir.catalysts.filter((c) => c.stage !== "active");
  const active = ir.catalysts.filter((c) => c.stage === "active");

  assert.ok(drafts.length > 0 && active.length > 0, "both states exist today");

  // No Physical-AI overlap is assumed here: classify with an empty series so
  // the IR-Fair stage is what decides.
  for (const c of drafts.slice(0, 20)) {
    assert.equal(
      classifyCatalystAccess(c.ticker, ir.catalysts, []),
      "free-draft",
      `${c.ticker} is a draft and must not be charged for`,
    );
  }
  for (const c of active) {
    assert.equal(
      classifyCatalystAccess(c.ticker, ir.catalysts, []),
      "paid",
      `${c.ticker} is researched and stays payable`,
    );
  }
});
