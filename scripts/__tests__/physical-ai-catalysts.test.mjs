/**
 * Physical-AI series dated-catalyst seed integrity.
 * Validates the editorial seed dataset + that the seed script's output is well
 * formed (main/sub counts, sub→main linkage, condition folds in fail direction,
 * event-type present for asymmetric scoring).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(REPO, p), "utf8"));

test("seed source: 63 main + 26 sub across 6 articles, every sub links a main", async () => {
  const seed = await readJson("data/physical-ai-catalysts.seed.json");
  assert.equal(seed.length, 89);
  assert.equal(seed.filter((r) => r.role === "main").length, 63);
  assert.equal(seed.filter((r) => r.role === "sub").length, 26);

  const mainKeys = new Set(
    seed.filter((r) => r.role === "main").map((r) => `${r.ticker}#${r.series_article}`),
  );
  for (const s of seed.filter((r) => r.role === "sub")) {
    assert.ok(
      mainKeys.has(`${s.parent_ticker}#${s.series_article}`),
      `sub ${s.ticker}#${s.series_article} has a main`,
    );
  }
  // Every row carries the fields the seed script needs.
  for (const r of seed) {
    for (const f of ["ticker", "company_name", "catalyst_type", "target_date", "main_condition", "fail_direction", "series_article"]) {
      assert.ok(r[f] != null && r[f] !== "", `${r.ticker} has ${f}`);
    }
    assert.match(r.target_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["earnings", "event", "fixed_date"].includes(r.catalyst_type));
  }
});

test("store: physical-ai entries seeded, pending, sub linked, description folds fail direction", async () => {
  const store = await readJson("data/external-catalysts.json");
  const pa = store.filter((c) => c.series === "physical-ai");
  // The store's physical-ai set must stay 1:1 with the editorial seed. Assert
  // that relationally (store count === seed count) rather than pinning a second
  // magic number, so adding to one but not the other is caught as drift — the
  // exact bug that broke this suite once the store gained 3 un-back-ported mains.
  const seed = await readJson("data/physical-ai-catalysts.seed.json");
  assert.equal(pa.length, seed.length, "store physical-ai count matches seed");

  // Entries start "pending"; the daily evaluate-catalysts judge then moves each
  // past-due one to a judged status. Assert the value is in the valid enum
  // rather than pinning "pending" (which the live store outgrows).
  const VALID_STATUS = new Set(["pending", "hit", "partial", "miss", "na"]);
  const byId = new Map(pa.map((c) => [c.catalyst_id, c]));
  for (const c of pa) {
    assert.ok(VALID_STATUS.has(c.status), `${c.ticker} status ${c.status} is valid`);
    assert.ok(c.catalyst_description.includes("【外れ方向】"), `${c.ticker} folds fail direction`);
    if (c.catalyst_role === "sub") {
      assert.ok(byId.has(c.parent_catalyst_id), `${c.ticker} sub parent exists`);
    }
  }
  // Event-type entries exist (they drive the absence=miss judge rule).
  assert.ok(pa.some((c) => c.catalyst_type === "event"));
});
