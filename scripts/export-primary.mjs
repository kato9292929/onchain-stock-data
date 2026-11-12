#!/usr/bin/env node
/**
 * Primary-source excerpts for the chat export (2026-11-08).
 *
 *   npm run export:chat:primary [-- --date YYYY-MM-DD]  → ops/chat-input/YYYY-MM-DD-primary.md
 *
 * The chat cannot open TDnet, JPX or company PDFs; it can open SEC. So for
 * Japanese companies this script fetches what judging and condition-writing
 * need and writes it next to the export, unedited:
 *
 *   F  for each JP row in A (jp / irf / ext): the latest 決算短信 on TDnet —
 *      title, time, PDF and XBRL URLs; results, prior-year, forecast and its
 *      revision flag straight from the XBRL; segment figures from the XBRL;
 *      受注 lines where the 短信 or the same-day materials state them; the
 *      revision notice's own table; up to 4 pages of the same-day 説明資料 /
 *      短信 text that mention the condition's terms.
 *   G  for each JP company in E / E-2: the latest 短信's full-year forecast,
 *      its date and URL, segment forecasts if tagged, and the next earnings
 *      date from the JPX schedule with its URL.
 *   H  for each JP company in D: the JPX schedule date and URL, or 未掲載.
 *
 * Network at export time only (TDnet, JPX); no key, no model, no paid source.
 * Figures are the XBRL values as filed, in yen. Text is pdftotext output.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzip } from "./lib/zip.mjs";
import { parseTdnetList } from "./fetch-financials.mjs";
import { fetchJpx, JPX_INDEX } from "./check-earnings-dates.mjs";
import { buildExport, loadFiles } from "./export-for-chat.mjs";

const UA = { headers: { "user-agent": "OnchainStockData research bot (osd.x402jp.com)" } };
const TDNET = "https://www.release.tdnet.info/inbs";
const JP_CODE = /^\d{3}[0-9A-Z]$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PAGES = 4;
const PAGE_CHARS = 2500;

// ── pure helpers (tested) ─────────────────────────────────────────────────

/** Every ix:nonFraction / ix:nonNumeric fact: local name, context, value. */
export function ixFacts(html) {
  const out = [];
  const meta = (attrs) => ({
    name: (attrs.match(/\bname="([^"]+)"/)?.[1] ?? "").replace(/^[^:]+:/, ""),
    ctx: attrs.match(/\bcontextRef="([^"]+)"/)?.[1] ?? "",
  });
  // Numbers first: they can sit inside a text block (a table tagged as one
  // nonNumeric), so they are read on their own pass.
  // A nil fact is self-closing (<ix:nonFraction … />): it must not swallow the next one.
  for (const m of html.matchAll(/<ix:nonFraction(\s[^>]*?)(?<!\/)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const num = m[2].replace(/<[^>]+>/g, "").replace(/[,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(num)) continue;
    const scale = Number(m[1].match(/\bscale="(-?\d+)"/)?.[1] ?? 0);
    const v = Number(num) * 10 ** scale;
    out.push({ ...meta(m[1]), value: /\bsign="-"/.test(m[1]) ? -v : v, numeric: true });
  }
  // Short text facts (flags such as 修正の有無). Text blocks are skipped.
  for (const m of html.matchAll(/<ix:nonNumeric(\s[^>]*?)(?<!\/)>((?:(?!<\/?ix:)[\s\S]){0,600}?)<\/ix:nonNumeric>/g)) {
    const f = meta(m[1]);
    if (/TextBlock$/.test(f.name)) continue;
    out.push({ ...f, value: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), numeric: false });
  }
  return out;
}

const LINES = [
  ["売上高", ["NetSales", "Revenue", "Revenues", "OperatingRevenues", "Sales", "NetRevenues", "OrdinaryRevenues"]],
  ["営業利益", ["OperatingIncome", "OperatingProfit"]],
  ["経常利益", ["OrdinaryIncome"]],
  ["純利益（親会社株主帰属）", ["ProfitAttributableToOwnersOfParent", "NetIncomeAttributableToOwnersOfParent", "NetIncome", "Profit"]],
];
const strip = (n) => n.replace(/(IFRS|US|JMIS)$/, "");

/** Summary facts → results, prior year, forecast, revision flag. Pure. */
export function summaryFigures(facts) {
  const pick = (re, names) => {
    for (const n of names) {
      const f = facts.find((x) => x.numeric && strip(x.name) === n && re.test(x.ctx));
      if (f) return f.value;
    }
    return null;
  };
  for (const basis of ["Consolidated", "NonConsolidated"]) {
    const cur = new RegExp(`^Current(AccumulatedQ\\d|Year)Duration_${basis}Member_ResultMember$`);
    const pri = new RegExp(`^Prior(AccumulatedQ\\d|Year)Duration_${basis}Member_ResultMember$`);
    const fc = new RegExp(`^(Current|Next)YearDuration_${basis}Member_ForecastMember$`);
    const hasCur = facts.some((x) => cur.test(x.ctx));
    if (!hasCur) continue;
    const period = facts.find((x) => cur.test(x.ctx))?.ctx.match(cur)?.[1] ?? "";
    const flag = facts.find((x) => !x.numeric && /^CorrectionOf.*FinancialForecastInThisQuarter$/.test(x.name));
    return {
      basis: basis === "Consolidated" ? "連結" : "単体",
      period: period.startsWith("AccumulatedQ") ? `第${period.slice(-1)}四半期累計` : "通期",
      rows: LINES.map(([label, names]) => ({
        label,
        current: pick(cur, names),
        prior: pick(pri, names),
        forecast: pick(fc, names),
      })),
      revision: flag ? flag.value : null,
    };
  }
  return null;
}

/** Japanese labels of company-specific members, from the -lab.xml linkbase. */
export function memberLabels(labXml) {
  const out = new Map();
  for (const m of String(labXml ?? "").matchAll(/xlink:label="[^"]*?_([A-Za-z0-9]+Member)_label"[^>]*xlink:role="http:\/\/www\.xbrl\.org\/2003\/role\/label"[^>]*>([^<]+)</g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

const STD_MEMBER = {
  ReportableSegmentsMember: "報告セグメント計",
  OperatingSegmentsNotIncludedInReportableSegmentsAndOtherRevenueGeneratingBusinessActivitiesMember: "その他",
  TotalOfReportableSegmentsAndOthersMember: "合計",
  ReconcilingItemsMember: "調整額",
};

/** Segment facts → rows of {segment, metric, current, prior}. Pure. */
export function segmentRows(facts, labels = new Map()) {
  const rows = new Map();
  for (const f of facts) {
    if (!f.numeric) continue;
    // "InterimDuration_…" (current half), "CurrentYTDDuration_…", "Prior1InterimDuration_…".
    const m = f.ctx.match(/^(Current|Prior1)?(YTD|Interim|Year|Quarter|AccumulatedQ\d)Duration_(.+Member)$/);
    if (!m) continue;
    const member = m[3].replace(/^.*?([A-Z][A-Za-z0-9]*Member)$/, "$1");
    const seg = labels.get(member) ?? STD_MEMBER[member] ?? member;
    const key = `${seg}::${f.name}`;
    const r = rows.get(key) ?? { segment: seg, metric: f.name, current: null, prior: null };
    if (m[1] === "Prior1") r.prior = f.value;
    else r.current = f.value;
    rows.set(key, r);
  }
  return [...rows.values()].filter((r) => /NetSales|Revenue|OperatingIncome|SegmentProfit|OrdinaryIncome|ProfitLoss/.test(r.metric));
}

/** Terms a condition turns on: katakana words, Latin acronyms, kanji compounds. Pure. */
export function conditionTerms(text) {
  const s = String(text ?? "");
  const terms = new Set([
    ...(s.match(/[ァ-ヴー・]{3,}/g) ?? []),
    ...(s.match(/[A-Za-z][A-Za-z0-9\-]{1,}/g) ?? []),
    ...(s.match(/[一-龥]{2,}/g) ?? []).filter((w) => !/決算|四半期|前年|同期|上振|当たり|確認|以上|以下|発表|前後|頃/.test(w)),
  ]);
  return [...terms].filter((t) => t.length >= 2);
}

const BASE_TERMS = ["受注", "受注残", "稼働率", "ABF", "FC-BGA", "パワー半導体", "データセンター", "MLCC", "ウェーハ", "ウエハ", "価格", "HBM", "EUV", "生成AI", "AIサーバ", "業績予想", "セグメント"];

/** The pages that say the most about the condition, at most `max`. Pure. */
export function pickPages(pages, terms, max = MAX_PAGES) {
  const score = (t) =>
    terms.reduce((n, w) => n + (t.includes(w) ? 3 : 0), 0) + BASE_TERMS.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  return pages
    .map((p) => ({ ...p, score: score(p.text) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/** Lines that state 受注高 / 受注残高. Pure. */
export function orderLines(text, max = 12) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => /受注(高|残高|残)/.test(l) && /\d/.test(l))
    .slice(0, max);
}

const yen = (v) => (v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} 円`);
const MATERIAL = /説明資料|補足資料|補足説明|プレゼンテーション|Presentation|ハイライト|決算概要|参考資料|Fact ?Book/i;
const REVISION = /業績予想.*修正|修正.*業績予想|予想値と実績値との差異/;

// ── fetching ──────────────────────────────────────────────────────────────

export async function get(url, as = "text") {
  const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return as === "buf" ? Buffer.from(await r.arrayBuffer()) : r.text();
}

/** TDnet disclosures of the last `days` days, by 4-character code. */
export async function tdnetIndex(codes, today, days = 31) {
  const by = new Map();
  for (let d = 0; d <= days; d += 1) {
    const ymd = new Date(Date.parse(`${today}T00:00:00Z`) - d * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    for (let p = 1; p <= 40; p += 1) {
      const page = String(p).padStart(3, "0");
      let html;
      try {
        html = await get(`${TDNET}/I_list_${page}_${ymd}.html`);
      } catch {
        break;
      }
      for (const r of parseTdnetList(html, ymd)) {
        if (!codes.has(r.code)) continue;
        const list = by.get(r.code) ?? [];
        list.push(r);
        by.set(r.code, list);
      }
      await sleep(150);
      if (!html.includes(`I_list_${String(p + 1).padStart(3, "0")}_${ymd}`)) break;
    }
  }
  for (const list of by.values()) list.sort((a, b) => (`${a.date}T${a.time}` < `${b.date}T${b.time}` ? 1 : -1));
  return by;
}

export function pdfPages(buf, label, url) {
  try {
    const text = execFileSync("pdftotext", ["-q", "-", "-"], { input: buf, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    return text.split("\f").map((t, i) => ({ source: label, url, page: i + 1, text: t.trim() })).filter((p) => p.text);
  } catch {
    return [];
  }
}

/** Everything for one company's latest 短信 (and its same-day documents). */
async function companyDocs(code, list) {
  const tanshin = (list ?? []).find((r) => /決算短信/.test(r.title) && r.xbrl_url && !/訂正/.test(r.title)) ??
    (list ?? []).find((r) => /決算短信/.test(r.title) && r.xbrl_url);
  if (!tanshin) return null;
  const sameDay = (list ?? []).filter((r) => r.date === tanshin.date && r !== tanshin);
  const zip = unzip(await get(tanshin.xbrl_url, "buf"));
  const html = (re) => [...zip.entries()].filter(([k]) => re.test(k)).map(([, v]) => v.toString("utf8"));
  const summary = summaryFigures(ixFacts(html(/Summary\/.*ixbrl\.htm$/).join("\n")));
  const labels = memberLabels(html(/Attachment\/.*-lab\.xml$/).join("\n"));
  const segments = segmentRows(ixFacts(html(/Attachment\/.*(sg|seg)[^/]*ixbrl\.htm$/).join("\n")), labels);
  const pages = [];
  if (tanshin.pdf_url) pages.push(...pdfPages(await get(tanshin.pdf_url, "buf"), tanshin.title, tanshin.pdf_url));
  const materials = sameDay.filter((r) => MATERIAL.test(r.title) && r.pdf_url);
  for (const m of materials) pages.push(...pdfPages(await get(m.pdf_url, "buf"), m.title, m.pdf_url));
  const revisions = [];
  for (const r of sameDay.filter((x) => REVISION.test(x.title) && x.pdf_url)) {
    const first = pdfPages(await get(r.pdf_url, "buf"), r.title, r.pdf_url)[0];
    if (first) revisions.push(first);
  }
  return { tanshin, summary, segments, pages, materials, revisions };
}

// ── rendering ─────────────────────────────────────────────────────────────

function renderFigures(L, s) {
  if (!s) {
    L.push("- 決算短信の XBRL から業績の値を読めなかった。");
    return;
  }
  L.push(`業績（${s.basis}・${s.period}、XBRL の値、単位 円）`);
  L.push("");
  L.push("| 項目 | 当期 | 前年同期 | 前四半期 | 通期予想（今回） |");
  L.push("| --- | ---: | ---: | --- | ---: |");
  for (const r of s.rows) L.push(`| ${r.label} | ${yen(r.current)} | ${yen(r.prior)} | 未取得（TDnet の掲載期間外） | ${yen(r.forecast)} |`);
  L.push("");
  L.push(`- 直近に公表した業績予想からの修正の有無（XBRL）：${s.revision ?? "記載なし"}`);
}

function renderSegments(L, segs) {
  if (segs.length === 0) {
    L.push("- セグメント別：短信の XBRL にセグメント別の数値なし（単一セグメント、または開示なし）");
    return;
  }
  L.push("");
  L.push("セグメント別（XBRL の値、単位 円。前四半期は TDnet の掲載期間外で未取得）");
  L.push("");
  L.push("| セグメント | 要素 | 当期 | 前年同期 |");
  L.push("| --- | --- | ---: | ---: |");
  for (const r of segs) L.push(`| ${r.segment} | ${r.metric} | ${yen(r.current)} | ${yen(r.prior)} |`);
}

const clip = (t) => (t.length > PAGE_CHARS ? `${t.slice(0, PAGE_CHARS)}\n（このページの残りは省略）` : t);

function renderF(L, groups, docs) {
  L.push(`## F. 判定に使う一次資料（A 節の日本株・${groups.length}社）`);
  L.push("");
  for (const g of groups) {
    const d = docs.get(g.code);
    L.push(`### ${g.code} ${g.company ?? ""}`);
    L.push("");
    L.push(`対象の行：${g.rows.map((r) => `\`${r.id}\``).join("、")}`);
    L.push("");
    for (const r of g.rows) L.push(`- 条件（${r.id}）：${r.success_condition}`);
    L.push("");
    if (!d) {
      L.push("- 直近31日の TDnet に決算短信がない（未発表、延期、または掲載期間外）。");
      L.push("");
      continue;
    }
    L.push(`- 書類：${d.tanshin.title}（${d.tanshin.date} ${d.tanshin.time}）`);
    L.push(`- PDF：${d.tanshin.pdf_url}`);
    L.push(`- XBRL：${d.tanshin.xbrl_url}`);
    L.push("");
    renderFigures(L, d.summary);
    for (const rv of d.revisions) {
      L.push("");
      L.push(`業績予想の修正（同日の開示「${rv.source}」 ${rv.url} の1ページ目、pdftotext の出力そのまま）`);
      L.push("");
      L.push("```");
      L.push(clip(rv.text));
      L.push("```");
    }
    renderSegments(L, d.segments);
    const orders = orderLines(d.pages.map((p) => p.text).join("\n"));
    L.push("");
    if (orders.length) {
      L.push("受注（決算短信・同日の資料の本文に書かれた行）");
      L.push("");
      L.push("```");
      for (const o of orders) L.push(o);
      L.push("```");
    } else {
      L.push("- 受注：四半期の受注は開示なし（決算短信と同日の資料の本文に受注高・受注残高の記載なし）");
    }
    L.push("");
    const terms = [...new Set(g.rows.flatMap((r) => conditionTerms(r.success_condition)))];
    const picked = pickPages(d.pages, terms);
    if (d.materials.length === 0) L.push("- 同日の TDnet に説明資料はない。下は決算短信の本文から。");
    else L.push(`- 同日の説明資料：${d.materials.map((m) => `${m.title}（${m.pdf_url}）`).join("、")}`);
    L.push(`- 抜粋の選び方：条件の語（${terms.slice(0, 12).join("・") || "なし"}）と ${BASE_TERMS.slice(0, 8).join("・")} などを含むページ、最大${MAX_PAGES}ページ`);
    for (const p of picked) {
      L.push("");
      L.push(`#### 「${p.source}」 ${p.page}ページ（${p.url}）`);
      L.push("");
      L.push("```");
      L.push(clip(p.text));
      L.push("```");
    }
    L.push("");
  }
}

/** JPX rows for a code, one per date (the same row can sit in several workbooks). */
function schedOf(jpx, code) {
  const seen = new Map();
  for (const r of (jpx.get(code) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))) if (!seen.has(r.date)) seen.set(r.date, r);
  return [...seen.values()];
}

function renderG(L, members, docs, jpx, fin) {
  L.push(`## G. 次の四半期の条件を書くための材料（E 節・E-2 節の日本株・${members.length}社）`);
  L.push("");
  for (const m of members) {
    const d = docs.get(m.code);
    const sched = schedOf(jpx, m.code);
    L.push(`### ${m.code} ${m.company ?? ""}（${m.themes.join("・")}）`);
    L.push("");
    if (d?.summary) {
      L.push(`- 直近の決算短信：${d.tanshin.title}（${d.tanshin.date}） ${d.tanshin.pdf_url}`);
      L.push(`- 通期予想（XBRL、単位 円）：${d.summary.rows.map((r) => `${r.label} ${yen(r.forecast)}`).join(" / ")}`);
      L.push(`- 直近に公表した業績予想からの修正の有無：${d.summary.revision ?? "記載なし"}`);
    } else {
      const f = fin?.companies?.[m.code]?.latest;
      L.push(
        f
          ? `- 直近の決算短信：${f.title}（${String(f.disclosed_at).slice(0, 10)}） ${f.document_url}（TDnet の掲載期間外のため通期予想は未取得）`
          : "- 直近の決算短信：直近31日の TDnet になく、記録もない",
      );
    }
    L.push("- セグメント別の通期予想：短信の XBRL に開示なし");
    if (sched.length) {
      for (const s of sched) L.push(`- 決算発表予定日（JPX）：${s.date}（${s.period ?? ""}） ${s.source_url}`);
    } else {
      L.push(`- 決算発表予定日（JPX）：未掲載（${JPX_INDEX}）`);
    }
    L.push("");
  }
}

function renderH(L, rows, jpx) {
  L.push(`## H. D 節の日本株の公表日（JPX 決算発表予定日）`);
  L.push("");
  L.push("| 行 | ticker | 会社名 | JPX の予定日 | 出典 |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const sched = schedOf(jpx, r.ticker);
    if (sched.length === 0) L.push(`| \`${r.id}\` | ${r.ticker} | ${r.company_name ?? ""} | 未掲載 | ${JPX_INDEX} |`);
    for (const s of sched) L.push(`| \`${r.id}\` | ${r.ticker} | ${r.company_name ?? ""} | ${s.date}（${s.period ?? ""}） | ${s.source_url} |`);
  }
  L.push("");
}

// ── main ──────────────────────────────────────────────────────────────────

const isJp = (r) => r.kind === "jp" || r.kind === "irf" || JP_CODE.test(String(r.ticker ?? ""));

async function main() {
  const args = process.argv.slice(2);
  const today = args.includes("--date") ? args[args.indexOf("--date") + 1] : new Date().toISOString().slice(0, 10);
  const files = await loadFiles();
  const fin = JSON.parse(await readFile("data/financials.json", "utf8").catch(() => "null"));
  const { due, unchecked, upcoming, renewal } = buildExport(files, { today, since: null });

  const groupsBy = new Map();
  for (const r of due.filter(isJp)) {
    const g = groupsBy.get(r.ticker) ?? { code: r.ticker, company: r.company_name, rows: [] };
    g.rows.push(r);
    groupsBy.set(r.ticker, g);
  }
  const groups = [...groupsBy.values()].sort((a, b) => (a.code < b.code ? -1 : 1));

  const memberBy = new Map();
  for (const { theme, members } of [...upcoming, ...renewal]) {
    for (const m of members) {
      if (!JP_CODE.test(m.ticker)) continue;
      const x = memberBy.get(m.ticker) ?? { code: m.ticker, company: m.company, themes: [] };
      if (!x.themes.includes(theme.id)) x.themes.push(theme.id);
      memberBy.set(m.ticker, x);
    }
  }
  const members = [...memberBy.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  const dRows = unchecked.filter(isJp);

  const codes = new Set([...groups.map((g) => g.code), ...members.map((m) => m.code), ...dRows.map((r) => r.ticker)]);
  console.log(`[primary] ${groups.length} companies for F, ${members.length} for G, ${dRows.length} rows for H — reading TDnet and JPX`);
  const index = await tdnetIndex(codes, today);
  const docs = new Map();
  for (const code of new Set([...groups.map((g) => g.code), ...members.map((m) => m.code)])) {
    try {
      const d = await companyDocs(code, index.get(code));
      if (d) docs.set(code, d);
    } catch (e) {
      console.warn(`::warning::${code}: ${e.message}`);
    }
    await sleep(150);
  }
  let jpx = new Map();
  try {
    jpx = (await fetchJpx()).map;
  } catch (e) {
    console.warn(`::warning::JPX: ${e.message}`);
  }

  const L = [];
  L.push(`# チャット運用の書き出し（一次資料）— ${today}`);
  L.push("");
  L.push(
    `${today}.md の続き。チャット側から開けない TDnet・JPX の一次資料を、CC が取得してそのまま載せた。` +
      "数字は決算短信 XBRL の値そのもの（単位 円）、本文は PDF を pdftotext にかけた出力そのもの。" +
      "前四半期の値は、TDnet の掲載期間（約1か月）外のため取得できていない。",
  );
  L.push("");
  renderF(L, groups, docs);
  renderG(L, members, docs, jpx, fin);
  renderH(L, dRows, jpx);

  await mkdir("ops/chat-input", { recursive: true });
  const out = path.join("ops", "chat-input", `${today}-primary.md`);
  await writeFile(out, L.join("\n"), "utf8");
  console.log(`[primary] wrote ${out} — ${docs.size} 短信 read, ${[...docs.values()].reduce((n, d) => n + d.materials.length, 0)} materials`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[primary] failed: ${e.message}`);
    process.exit(1);
  });
}
