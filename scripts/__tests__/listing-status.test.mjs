/**
 * The check nobody was doing.
 *
 * 6967 新光電気工業 delisted on 2025-06-06. It was selected on 2026-06-22, its
 * catalyst came back `na` — a delisted company files no earnings to judge —
 * and it was selected again on 2026-10-12, sixteen months after it stopped
 * trading. Scoring caught it every time; selection never looked.
 *
 * The screen is POSITIVE on purpose. JPX's 上場廃止銘柄一覧, fetched 2026-10-14,
 * covered 2026/01/05 onward and did not contain 6967 at all — screening
 * against the delisted list would have passed the exact ticker that caused
 * the problem. These tests pin that direction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { excludeDelisted, snapshotAgeDays } = await import(
  "../../lib/listing-status.ts"
);

const snapshot = {
  as_of: "2026-09-30",
  listed: {
    "6146": { name: "ディスコ", segment: "プライム（内国株式）" },
    "4062": { name: "イビデン", segment: "プライム（内国株式）" },
    "2802": { name: "味の素", segment: "プライム（内国株式）" },
    // 6967 is absent, exactly as it is in the real master.
  },
};

test("a delisted pick is excluded and named", () => {
  const { kept, dropped } = excludeDelisted(
    [
      { ticker: "6146", company_name: "ディスコ", weight: 40 },
      { ticker: "6967", company_name: "新光電気工業", weight: 20 },
      { ticker: "4062", company_name: "イビデン", weight: 40 },
    ],
    snapshot,
  );
  assert.deepEqual(kept.map((h) => h.ticker), ["6146", "4062"]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].ticker, "6967");
  assert.equal(dropped[0].company_name, "新光電気工業");
  assert.match(dropped[0].reason, /2026-09-30/, "the reason names the snapshot");
});

test("surviving weights still sum to 100", () => {
  // A book that adds up to 80 is a published defect, so the remainder is
  // redistributed rather than left as a hole.
  const { kept } = excludeDelisted(
    [
      { ticker: "6146", weight: 40 },
      { ticker: "6967", weight: 20 },
      { ticker: "4062", weight: 30 },
      { ticker: "2802", weight: 10 },
    ],
    snapshot,
  );
  assert.equal(kept.reduce((n, h) => n + h.weight, 0), 100);
  assert.ok(kept[0].weight > kept[2].weight, "relative sizing is preserved");
});

test("an all-listed week is left untouched", () => {
  const holdings = [
    { ticker: "6146", weight: 50 },
    { ticker: "4062", weight: 50 },
  ];
  const { kept, dropped } = excludeDelisted(holdings, snapshot);
  assert.deepEqual(dropped, []);
  assert.deepEqual(kept, holdings, "no renormalisation when nothing was dropped");
});

test("the real snapshot excludes 6967 and 6957, and keeps the other 14", () => {
  // Against the committed file, not a fixture — this is the assertion that
  // would have failed every week the bug was live.
  const real = JSON.parse(readFileSync("data/jp-listed.json", "utf8"));
  const lastTwoWeeks = [
    "2802", "3110", "3436", "4004", "4062", "6146", "6504", "6594",
    "6723", "6787", "6857", "6920", "6967", "6981", "8035",
  ].map((ticker) => ({ ticker, weight: 100 / 15 }));

  const { kept, dropped } = excludeDelisted(lastTwoWeeks, real);
  assert.deepEqual(dropped.map((d) => d.ticker), ["6967"]);
  assert.equal(kept.length, 14);
  assert.equal(real.listed["6957"], undefined, "6957 芝浦電子 delisted 2026-01-13");
  assert.ok(real.count > 3000, `master looks truncated: ${real.count}`);
});

test("snapshot age is measured so a stale screen can be flagged", () => {
  assert.equal(snapshotAgeDays(snapshot, "2026-10-14"), 14);
  assert.equal(snapshotAgeDays(snapshot, "2026-09-30"), 0);
});
