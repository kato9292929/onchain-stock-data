/**
 * Minimal zip and xlsx readers (stored + deflated entries), no dependencies.
 * Shared by the JPX roster (refresh-jp-listed), the JPX earnings schedule
 * (check-earnings-dates) and the TDnet XBRL packages (fetch-financials).
 */
import zlib from "node:zlib";

/** name → Buffer for every entry whose name passes `want`. */
export function unzip(buf, want = () => true) {
  const out = new Map();
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
    if (want(name)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unescapeXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Column letters ("B", "AA") → 0-based index. */
function colIndex(ref) {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * First worksheet as rows of strings. Cells are placed by their `r`
 * reference, so blank cells (which writers omit) do not shift columns.
 */
export function readXlsx(buf, sheet = "xl/worksheets/sheet1.xml") {
  const files = unzip(buf, (n) => n.endsWith(".xml"));
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) {
    for (const si of ss.split("<si>").slice(1)) {
      shared.push(unescapeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const xml = files.get(sheet)?.toString("utf8");
  if (!xml) throw new Error(`${sheet} missing from the workbook`);
  const rows = [];
  for (const r of xml.split("<row ").slice(1)) {
    const cells = [];
    for (const m of r.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, attrs, inner = ""] = m;
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const isText = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let value = "";
      if (v !== undefined) value = /\bt="s"/.test(attrs) ? shared[Number(v)] ?? "" : unescapeXml(v);
      else if (isText !== undefined) value = unescapeXml(isText);
      const idx = ref ? colIndex(ref) : cells.length;
      cells[idx] = value;
    }
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}

/** Excel serial date (1900 system) → YYYY-MM-DD. */
export function excelDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
}
