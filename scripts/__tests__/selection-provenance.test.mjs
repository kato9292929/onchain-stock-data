/**
 * Did the model see outside data this week, or only its own weights?
 *
 * The flag was computed on every run and never written down — it lived on the
 * function's return value, not on the persisted entry — so for every week
 * already on record the answer is unrecoverable. That mattered once it turned
 * out the selection prompt carries no tools and no market data: the credit
 * spread claims in `rationale` are generated text, and nothing in the file
 * distinguished a week that had external context from one that had none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/jobs.ts", "utf8");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

test("JP records false structurally, not by accident", () => {
  // selectJpPortfolio has no externalContext parameter at all, so this cannot
  // become true by configuration — pin it to a literal rather than an expression.
  const jp = SRC.slice(SRC.indexOf("const portfolio: JpPortfolio = {"));
  assert.match(jp.slice(0, 600), /used_external_data: false/);
  assert.match(jp.slice(0, 600), /external_source: null/);
});

test("US records the real outcome of the fetch", () => {
  const us = SRC.slice(SRC.indexOf("const portfolio: Portfolio = {"));
  assert.match(
    us.slice(0, 600),
    /used_external_data: externalContext\.length > 0/,
    "true/false must follow whether the block was actually built",
  );
  assert.match(us.slice(0, 600), /external_source: externalSource/);
});

test("only the host is kept, never the URL", () => {
  // The endpoint is configuration; a data file that is committed and served
  // publicly is the wrong place for it.
  assert.match(SRC, /const externalSource = hostOf\(process\.env\.AA_EXTERNAL_DATA_URL\)/);
  assert.doesNotMatch(
    SRC,
    /external_source: process\.env\.AA_EXTERNAL_DATA_URL/,
    "the raw URL must never be persisted",
  );
  assert.match(SRC, /function hostOf/);
});

test("fetched_at is null when nothing was fetched", () => {
  assert.match(SRC, /externalData \? new Date\(\)\.toISOString\(\) : null/);
});

test("existing entries are left unfilled — absent is not false", () => {
  // Back-filling would invent a fact about weeks nobody recorded.
  for (const f of [
    "data/portfolio-history.json",
    "data/jp-portfolio-history.json",
  ]) {
    const h = read(f);
    const all = [...(h.current ? [h.current] : []), ...(h.history ?? [])];
    const old = all.filter((p) => p.week_of < "2026-10-16");
    assert.ok(old.length > 0, `${f}: no prior weeks to check`);
    assert.ok(
      old.every((p) => p.used_external_data === undefined),
      `${f}: a prior week was back-filled`,
    );
  }
});
