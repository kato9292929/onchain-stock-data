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

test("seed source: 60 main + 26 sub across 6 articles, every sub links a main", async () => {
  const seed = await readJson("data/physical-ai-catalysts.seed.json");
  assert.equal(seed.length, 86);
  assert.equal(seed.filter((r) => r.role === "main").length, 60);
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
  assert.equal(pa.length, 86);

  const byId = new Map(pa.map((c) => [c.catalyst_id, c]));
  for (const c of pa) {
    assert.equal(c.status, "pending");
    assert.ok(c.catalyst_description.includes("【外れ方向】"), `${c.ticker} folds fail direction`);
    if (c.catalyst_role === "sub") {
      assert.ok(byId.has(c.parent_catalyst_id), `${c.ticker} sub parent exists`);
    }
  }
  // Event-type entries exist (they drive the absence=miss judge rule).
  assert.ok(pa.some((c) => c.catalyst_type === "event"));
});
