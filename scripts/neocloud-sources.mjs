#!/usr/bin/env node
/**
 * Check a chat `metrics` answer against the documents before it is imported.
 *
 *   npm run neocloud:sources -- <answer.json> [--out <fixed.json>]
 *
 * For each row with a number:
 *   - the cited document prints the number → kept as it is
 *   - otherwise (a reprint site, a page that cannot be read, or a miss) the
 *     company's EDGAR filings of the same date (±1 day: the primary document
 *     and its Ex.99) are searched; where one prints it, that filing becomes
 *     the source (`replaced_from` keeps the old URL)
 *   - otherwise the row is dropped and written to <fixed>-dropped.json, to go
 *     back to the chat
 * Rows without a number follow the filing their URL was moved to by the
 * other rows of the same URL; a reprint that moved nowhere is dropped.
 * Nothing is computed: a number counts as found only when the document prints
 * it (e.g. 1.59 → "1.59 billion", "1,590 million", "1,590,000").
 *
 * Network at check time only (SEC EDGAR); free.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEOCLOUD_CIKS, SEC_UA, edgarFilings, htmlToText } from "./lib/neocloud-feed.mjs";
import { exhibitsFromIndex } from "./lib/neocloud-feed.mjs";
import { isReprint, normalizeMetric } from "./import-from-chat.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textCache = new Map();

async function docText(url) {
  if (textCache.has(url)) return textCache.get(url);
  let text = null;
  try {
    const r = await fetch(url, { headers: { "user-agent": SEC_UA }, signal: AbortSignal.timeout(60_000) });
    if (r.ok) text = htmlToText(await r.text()).replace(/[$ ~≈]/g, " ").replace(/[ \t]+/g, " ");
  } catch {
    text = null;
  }
  await sleep(150);
  textCache.set(url, text);
  return text;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 13 → "13(?:\.0+)?", 1.59 → "1\.59(?:0+)?" */
const numRe = (v) => {
  const s = String(Number(v.toFixed(6)));
  return s.includes(".") ? `${esc(s)}0*` : `${esc(s)}(?:\\.0+)?`;
};
const commaRe = (v) => {
  const [i, d] = String(Number(v.toFixed(3))).split(".");
  const withComma = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const ip = `(?:${esc(withComma)}|${esc(i)})`;
  return d ? `${ip}\\.${esc(d)}0*` : `${ip}(?:\\.0+)?`;
};

/** Not preceded by a digit, comma or point: 7 must not match the 7 of "38.7". */
const NB = "(?<![\\d.,])";

/** The unit word ends here; a footnote number may follow ("$15 billion11"). */
const END = "(?![a-z])";

/** The ways a filing prints a raw chat number (value in the chat's own unit). Pure. */
export function numberPatterns(value, unit) {
  const u = String(unit ?? "");
  if (typeof value !== "number") return [];
  if (u === "MW") return [new RegExp(`${NB}${commaRe(value)}\\s*(?:MWs?|megawatts?)${END}`, "i"), new RegExp(`${NB}${numRe(value / 1000)}\\s*(?:GWs?|gigawatts?)${END}`, "i")];
  if (u === "GW") return [new RegExp(`${NB}${numRe(value)}\\s*(?:GWs?|gigawatts?)${END}`, "i")];
  if (/bn|billion/i.test(u)) {
    return [
      new RegExp(`${NB}${numRe(value)}\\s*(?:billion|bn|B)${END}`, "i"),
      new RegExp(`${NB}${commaRe(value * 1000)}\\s*(?:million|mn|M)${END}`, "i"),
      new RegExp(`(?<![\\d.,])${commaRe(value * 1e6)}(?![\\d,])`),
    ];
  }
  if (/\bm\b|million|mn/i.test(u)) {
    return [new RegExp(`${NB}${numRe(value)}\\s*(?:million|mn|M)${END}`, "i"), new RegExp(`(?<![\\d.,])${commaRe(value * 1000)}(?![\\d,])`)];
  }
  // A table in thousands prints the number itself: 728,982.
  if (/thousand|\bk\b/i.test(u)) return [new RegExp(`(?<![\\d.,])${commaRe(value)}(?![\\d,])`)];
  if (u === "USD") return [new RegExp(`(?<![\\d.,])${commaRe(value)}(?![\\d,])`)];
  return [];
}

/** A range as filings print it: "$17-20B", "13.0 billion to 13.3 billion", "$40–45 billion". Pure. */
export function rangePatterns(low, high, unit) {
  const u = String(unit ?? "");
  if (typeof low !== "number" || typeof high !== "number") return [];
  const word = /bn|billion/i.test(u) ? "(?:billion|bn|B)" : /\bm\b|million|mn/i.test(u) ? "(?:million|mn|M)" : u === "MW" ? "(?:MWs?|megawatts?)" : null;
  if (!word) return [];
  return [new RegExp(`${NB}${numRe(low)}\\s*(?:${word}\\s*)?(?:-|–|—|to)\\s*\\$?\\s*${numRe(high)}\\s*${word}${END}`, "i")];
}

export function findNumber(text, value, unit, high = null) {
  if (!text) return null;
  for (const re of [...rangePatterns(value, high, unit), ...numberPatterns(value, unit)]) {
    const m = re.exec(text);
    if (m) return text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 40).replace(/\s+/g, " ");
  }
  return null;
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function sameDayDocs(ticker, date) {
  const filings = await edgarFilings(ticker, { from: addDays(date, -1), to: addDays(date, 1) });
  const docs = [];
  for (const f of filings) {
    docs.push({ url: f.url, label: `${f.form} ${f.filed_at}` });
    if (/^(8-K|6-K)/.test(f.form)) {
      try {
        const r = await fetch(`${f.folder}/${f.accession}-index.htm`, { headers: { "user-agent": SEC_UA } });
        await sleep(150);
        for (const ex of exhibitsFromIndex(await r.text(), f.folder)) docs.push({ url: ex.url, label: `${f.form} ${ex.label} ${f.filed_at}` });
      } catch {
        // primary document only
      }
    }
  }
  return docs;
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  if (!input) {
    console.error("usage: neocloud-sources.mjs <answer.json> [--out fixed.json]");
    process.exit(2);
  }
  const payload = JSON.parse(await readFile(input, "utf8"));
  const items = payload.items ?? [];
  const mapped = new Map(); // reprint URL → SEC URL, established by a found number
  const report = [];

  // Pass 1: rows with a number. Kept when the cited document prints it;
  // otherwise moved to the company's EDGAR filing of that date that does;
  // otherwise dropped (and listed, to go back to the chat).
  const dropped = new Set();
  for (const [i, raw] of items.entries()) {
    const value = typeof raw.value === "number" ? raw.value : null;
    if (value === null) continue;
    const ticker = String(raw.ticker).toUpperCase();
    const item = raw.metric ?? raw.item;
    if (!isReprint(raw.source_url)) {
      const snip = findNumber(await docText(raw.source_url), value, raw.unit, raw.value_high ?? raw.high ?? null);
      if (snip) {
        report.push({ i, ticker, item, result: "found in the cited document", snip });
        continue;
      }
    }
    let hit = null;
    if (NEOCLOUD_CIKS[ticker]) {
      for (const d of await sameDayDocs(ticker, raw.published_at)) {
        const snip = findNumber(await docText(d.url), value, raw.unit, raw.value_high ?? raw.high ?? null);
        if (snip) {
          hit = { ...d, snip };
          break;
        }
      }
    }
    if (hit) {
      if (!mapped.has(raw.source_url)) mapped.set(raw.source_url, hit.url);
      items[i] = { ...raw, source_url: hit.url, replaced_from: raw.source_url };
      report.push({ i, ticker, item, result: `moved → ${hit.label}`, snip: hit.snip });
    } else {
      dropped.add(i);
      report.push({ i, ticker, item, result: "DROPPED: the number is not in the cited document nor in the EDGAR filings of that date" });
    }
  }
  // Pass 2: rows without a number follow the filing their URL was moved to;
  // a reprint that moved nowhere is dropped.
  for (const [i, raw] of items.entries()) {
    if (typeof raw.value === "number") continue;
    const to = mapped.get(raw.source_url);
    if (to) {
      items[i] = { ...raw, source_url: to, replaced_from: raw.source_url };
      report.push({ i, ticker: raw.ticker, item: raw.metric ?? raw.item, result: "no number; follows the same release → moved" });
    } else if (isReprint(raw.source_url)) {
      dropped.add(i);
      report.push({ i, ticker: raw.ticker, item: raw.metric ?? raw.item, result: "DROPPED: no number, reprint URL" });
    } else {
      report.push({ i, ticker: raw.ticker, item: raw.metric ?? raw.item, result: "no number; kept on its own URL" });
    }
  }
  report.sort((a, b) => a.i - b.i);
  for (const r of report) console.log(`${String(r.i).padStart(2)} ${r.ticker} ${r.item}: ${r.result}${r.snip ? `\n     “${r.snip}”` : ""}`);
  const kept = items.filter((_, i) => !dropped.has(i));
  console.log(`[sources] ${kept.length} kept (${items.filter((x) => x.replaced_from).length} moved to the filing), ${dropped.size} dropped`);
  if (out) {
    await writeFile(out, `${JSON.stringify({ ...payload, items: kept }, null, 2)}\n`, "utf8");
    const back = items.filter((_, i) => dropped.has(i));
    await writeFile(out.replace(/\.json$/, "-dropped.json"), `${JSON.stringify({ ...payload, items: back }, null, 2)}\n`, "utf8");
    console.log(`[sources] wrote ${out} and its -dropped.json`);
  }
}

// normalizeMetric is re-exported for callers that want the schema's reading of a row.
export { normalizeMetric };

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[sources] failed: ${e.message}`);
    process.exit(1);
  });
}
