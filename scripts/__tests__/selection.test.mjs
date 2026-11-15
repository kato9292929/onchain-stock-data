import { test } from "node:test";
import assert from "node:assert/strict";

const { loadRecords } = await import("../../lib/solana-stocks-load.ts");
const { selectionRows, sameWording } = await import("../../lib/selection.ts");

const rec = await loadRecords();
const rows = selectionRows(rec, "2026-11-15");

test("selection: wording compared across editions ignores full/half-width, spacing and the 外れ方向 tail", () => {
  assert.equal(
    sameWording("Barber Lake第1期（168MW）を2026-09-30までにFluidstackへ納入【外れ方向】納入遅延"),
    sameWording("Barber Lake第1期(168MW)を2026-09-30までにFluidstackへ納入【外れ方向】納入遅延、またはテナント受入(acceptance)の後ろ倒し"),
  );
  assert.notEqual(sameWording("年末のARRが70億ドル以上"), sameWording("年末の接続済み電力が0.8GW以上"));
});

test("selection: a condition carried unchanged into the next article edition is counted once (CIFR Barber Lake)", () => {
  const cifr = rows.filter((r) => r.ticker === "CIFR" && r.target_date === "2026-09-30");
  assert.equal(cifr.length, 1, cifr.map((r) => r.id).join(", "));
  assert.equal(cifr[0].result, "miss");
});

test("selection: no two rows share an id", () => {
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});
