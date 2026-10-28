/**
 * Refresh data/jp-listed.json from JPX's listing master.
 *
 * Source: 東証上場銘柄一覧 (data_j.xlsx), linked from
 * https://www.jpx.co.jp/markets/statistics-equities/misc/01.html
 * — ~4,450 rows of コード / 銘柄名 / 市場・商品区分 / 33業種区分, republished
 * monthly. It is the only JPX file that states what IS listed; the
 * 上場廃止銘柄一覧 page is a rolling window (2026/01 onward when checked on
 * 2026-10-14) and silently omits anything older, including 6967.
 *
 * Free and unauthenticated — no API key, no cost. Run it before the weekly
 * selection, or on its own schedule, and commit the result.
 *
 *   node scripts/refresh-jp-listed.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "jp-listed.json");
const INDEX = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html";

/** Minimal xlsx reader: the sheet is a flat table, so unzip + parse two parts. */
function readXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) {
    for (const si of ss.split("<si>").slice(1)) {
      shared.push(
        [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((m) => m[1])
          .join("")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">"),
      );
    }
  }
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("sheet1.xml missing from the workbook");

  const rows = [];
  for (const r of sheet.split("<row ").slice(1)) {
    const cells = [];
    // Attribute order varies between writers, so capture the whole opening tag
    // and test it, rather than trying to position t="s" inside one pattern —
    // getting that wrong silently yields shared-string indices as values.
    for (const m of r.matchAll(/<c([^>]*)>(?:<v>([\s\S]*?)<\/v>)?/g)) {
      const [, attrs, value] = m;
      if (value === undefined) cells.push("");
      else if (/\bt="s"/.test(attrs)) cells.push(shared[Number(value)] ?? "");
      else cells.push(value);
    }
    rows.push(cells);
  }
  return rows;
}

/** Stored + deflated entries are all this workbook uses. */
function unzip(buf) {
  const out = new Map();
  // Walk the central directory backwards from the end-of-central-directory record.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("not a zip file");
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);

  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (name.endsWith(".xml")) {
      out.set(
        name,
        (method === 0 ? raw : zlib.inflateRawSync(raw)).toString("utf8"),
      );
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function main() {
  const index = await fetch(INDEX).then((r) => r.text());
  const href = index.match(/href="([^"]*data_j\.xlsx)"/i)?.[1];
  if (!href) throw new Error(`no data_j.xlsx link on ${INDEX}`);
  const url = new URL(href, INDEX).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const rows = readXlsx(Buffer.from(await res.arrayBuffer()));

  const [header, ...body] = rows;
  const col = (name) => header.findIndex((h) => h === name);
  const iDate = col("日付");
  const iCode = col("コード");
  const iName = col("銘柄名");
  const iSeg = col("市場・商品区分");
  const iSector = col("33業種区分");
  if (iCode < 0 || iSeg < 0) {
    throw new Error(`unexpected columns: ${JSON.stringify(header)}`);
  }

  const listed = {};
  let asOf = "";
  for (const r of body) {
    const code = String(r[iCode] ?? "").trim();
    if (!code) continue;
    listed[code] = {
      name: r[iName] ?? "",
      segment: r[iSeg] ?? "",
      sector33: iSector >= 0 ? (r[iSector] ?? "") : "",
    };
    const d = String(r[iDate] ?? "");
    if (!asOf && /^\d{8}$/.test(d)) {
      asOf = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }
  }

  const count = Object.keys(listed).length;
  // A parse that half-works would quietly shrink the universe and start
  // excluding live companies, which is worse than not screening at all.
  if (count < 3000) throw new Error(`only ${count} rows parsed — refusing to write`);

  await writeFile(
    OUT,
    `${JSON.stringify({ source: url, as_of: asOf, count, listed }, null, 2)}\n`,
    "utf8",
  );
  console.log(`[jp-listed] wrote ${OUT} — ${count} companies, as_of ${asOf}`);

  // Re-check the IR Fair roster against the master we just pulled. Its
  // tse_market column had never been reconciled against a primary source —
  // when first checked on 2026-10-15, 91 of 197 rows disagreed — so a silent
  // drift back is worth catching the next time JPX republishes.
  await reconcileRoster(listed, asOf);
}

const SEGMENTS = ["プライム", "スタンダード", "グロース"];
const segmentOf = (s) => SEGMENTS.find((k) => String(s ?? "").includes(k)) ?? "";

async function reconcileRoster(listed, asOf) {
  const file = path.join(ROOT, "data", "ir-fair-2026-catalysts.json");
  let roster;
  try {
    roster = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    console.warn(`[jp-listed] roster not reconciled: ${e.message}`);
    return;
  }
  const drift = [];
  const gone = [];
  for (const c of roster.catalysts ?? []) {
    const m = listed[c.ticker];
    if (!m) {
      gone.push(`${c.ticker} ${c.company_name}`);
      continue;
    }
    const want = segmentOf(m.segment);
    if (segmentOf(c.tse_market) !== want) {
      drift.push(`${c.ticker} ${c.company_name}: ${c.tse_market} -> ${want}`);
    }
  }
  if (gone.length > 0) {
    console.warn(
      `::warning::[jp-listed] ${gone.length} roster companies are no longer listed: ${gone.join(", ")}`,
    );
  }
  if (drift.length > 0) {
    console.warn(
      `::warning::[jp-listed] ${drift.length} roster segments disagree with JPX (as_of ${asOf}):\n  ${drift.join("\n  ")}`,
    );
  } else {
    console.log(`[jp-listed] roster segments match JPX (as_of ${asOf})`);
  }
}

main().catch((e) => {
  console.error(`::error::refresh-jp-listed failed: ${e.message}`);
  process.exit(1);
});
