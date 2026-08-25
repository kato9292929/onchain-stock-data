#!/usr/bin/env node
/**
 * Seed the external-catalysts store with the editorial Physical-AI series
 * dated catalysts (data/physical-ai-catalysts.seed.json → data/external-catalysts.json).
 *
 * Idempotent: each catalyst gets a DETERMINISTIC id derived from
 * (series, article, role, ticker, condition), so re-running never duplicates
 * and never clobbers an already-judged entry — existing ids are left untouched,
 * only missing ones are inserted as `pending`. Sub-conditions (補助線) become
 * their own scorable entries linked to the main via `parent_catalyst_id`.
 *
 * Unlike the HTTP submit path this bypasses validateSubmission (so past/near
 * dates and long descriptions are allowed). The daily evaluate-catalysts job
 * judges each entry once `target_date + GRACE_DAYS` passes.
 *
 * Usage: node scripts/seed-physical-ai-catalysts.mjs   (npm run seed:physical-ai)
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_FILE = path.join(REPO, "data/physical-ai-catalysts.seed.json");
const STORE_FILE = path.join(REPO, "data/external-catalysts.json");
const SERIES = "physical-ai";

/** Deterministic ext_ id from the catalyst's stable identity. */
function catalystId(row) {
  const key = [SERIES, row.series_article, row.role, row.ticker, row.main_condition].join("|");
  return "ext_" + createHash("sha1").update(key).digest("hex").slice(0, 8);
}

/** Fold the binary condition + its fail direction into the judged description. */
function toDescription(row) {
  return `${row.main_condition}【外れ方向】${row.fail_direction}`;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  const seed = JSON.parse(await readFile(SEED_FILE, "utf8"));
  const store = await readStore();
  const existing = new Set(store.map((c) => c.catalyst_id));

  // Resolve main ids first so sub-conditions can point at their parent.
  const mainIdByKey = new Map();
  for (const row of seed) {
    if (row.role === "main") mainIdByKey.set(`${row.ticker}#${row.series_article}`, catalystId(row));
  }

  const nowIso = new Date().toISOString();
  let added = 0;
  const inserted = [];
  for (const row of seed) {
    const id = catalystId(row);
    if (existing.has(id)) continue;
    const parent =
      row.role === "sub"
        ? mainIdByKey.get(`${row.parent_ticker}#${row.series_article}`) ?? null
        : null;
    inserted.push({
      catalyst_id: id,
      ticker: row.ticker,
      market: row.market === "JP" ? "JP" : "US",
      source: `series:${SERIES}#${row.series_article}`,
      conviction: null,
      agent_id: null,
      catalyst_description: toDescription(row),
      target_date: row.target_date,
      submitted_at: nowIso,
      submitter_contact: null,
      status: "pending",
      judgement_date: null,
      evidence_urls: [],
      reasoning: null,
      catalyst_type: row.catalyst_type,
      date_confidence: row.date_confidence,
      country: row.country,
      series: SERIES,
      series_article: row.series_article,
      catalyst_role: row.role,
      parent_catalyst_id: parent,
      company_name: row.company_name,
    });
    existing.add(id);
    added++;
  }

  const next = [...store, ...inserted];
  await writeFile(STORE_FILE, JSON.stringify(next, null, 2) + "\n");

  const mains = inserted.filter((c) => c.catalyst_role === "main").length;
  const subs = inserted.filter((c) => c.catalyst_role === "sub").length;
  console.log(
    `seed complete: +${added} added (${mains} main / ${subs} sub), ` +
      `${seed.length - added} already present, ${next.length} total in store`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
