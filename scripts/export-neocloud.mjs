#!/usr/bin/env node
/**
 * Neocloud filings for the chat, in one file: ops/chat-input/YYYY-MM-DD-neocloud.md
 *
 *   npm run export:chat:neocloud -- [--quarter] [--from YYYY-MM-DD] [--date YYYY-MM-DD]
 *
 *   default     every filing of the last 7 days (the same feed as export:chat F)
 *   --quarter   per US company the latest 10-Q / 10-K / 20-F / 40-F and every
 *               8-K / 6-K since --from (default: the day after the last quarter
 *               end); per JP company the latest 決算短信 and its same-day
 *               materials, and later disclosures
 *
 * The chat answers with `metrics` (and `signals`), ops/chat-schema.md §6.
 * Also merges the filing metadata into data/neocloud-filings.json, which
 * /api/neocloud/digest reads. Network at export time only; free sources.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFeed, filingIndexRows, mergeFilingIndex, renderFeed } from "./lib/neocloud-feed.mjs";
import { neocloudCompanies, windowStart } from "../lib/neocloud.ts";

const ROOT = process.cwd();
const FILINGS = path.join(ROOT, "data", "neocloud-filings.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** The day after the last calendar quarter end before `today`. Pure. */
export function quarterStart(today) {
  const d = new Date(`${today}T00:00:00Z`);
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1)).toISOString().slice(0, 10);
}

/** Write the feed's filing metadata into data/neocloud-filings.json. */
export async function keepFilingIndex(feed, today) {
  const merged = mergeFilingIndex(await readJson(FILINGS, null), filingIndexRows(feed), today);
  await writeFile(FILINGS, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

export async function neocloudCompaniesFromRepo() {
  return neocloudCompanies(await readJson(path.join(ROOT, "data", "themes.json"), null));
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const today = arg("--date") ?? new Date().toISOString().slice(0, 10);
  const quarter = args.includes("--quarter");
  const from = arg("--from") ?? (quarter ? quarterStart(today) : windowStart(today, 7));
  const companies = await neocloudCompaniesFromRepo();
  const feed = await collectFeed({
    companies,
    from,
    to: today,
    mode: quarter ? "quarter" : "window",
    log: (m) => console.log(`[neocloud] ${m}`),
  });
  const heading = quarter
    ? `# ネオクラウドの数値：最新の四半期報告と ${from} 以降の開示（${today}）`
    : `# ネオクラウドの直近7日の開示（${today}）`;
  const intro = quarter
    ? [
        "米国の上場10社は最新の四半期報告（10-Q など）と、それ以降の 8-K / 6-K（決算発表の Ex.99.1 を含む）。日本の5社は直近の決算短信と同じ日の説明資料。",
        "各社の 7 項目（契約済みの電力容量・稼働容量・受注残/RPO・売上ガイダンス・設備投資ガイダンス・資金調達・主要な契約）を `metrics` で返す。",
        "書いていない項目は `value: null` の行で返す（推定しない）。",
        "",
      ]
    : [];
  const md = renderFeed(feed, { heading, intro });
  await mkdir(path.join(ROOT, "ops", "chat-input"), { recursive: true });
  const out = path.join(ROOT, "ops", "chat-input", `${today}-neocloud.md`);
  await writeFile(out, `${md}\n`, "utf8");
  const kept = await keepFilingIndex(feed, today);
  console.log(
    `[neocloud] ${path.relative(ROOT, out)}: ${feed.filings.length} filings, ${feed.errors.length} errors; ` +
      `data/neocloud-filings.json ${kept.filings.length} rows`,
  );
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[neocloud] failed: ${e.message}`);
    process.exit(1);
  });
}
