#!/usr/bin/env node
/**
 * Write the next batch of US stocks for the chat to research:
 * ops/chat-input/stocks-research-YYYY-MM-DD-NN.md
 *
 * The universe is every tokenized stock on Solana (data/solana-stocks.json)
 * that files with the SEC, ETFs left out. A company already researched (any
 * "stocks-us" row), already handed over in an earlier batch file, or with a
 * pending condition from another series is skipped, so each run hands over the
 * next `--size` companies (default 25).
 *
 * For each company the file carries what the chat needs to set one condition:
 * its last four quarters of revenue, operating income, net income and diluted
 * EPS as filed (SEC EDGAR XBRL, fetched now — free, public, no key). The answer
 * comes back as `stock_catalysts` JSON through scripts/import-from-chat.mjs, and
 * scripts/judge-stocks-edgar.mjs judges it from EDGAR when the quarter is filed.
 * No model call, no paid API.
 *
 *   node --import tsx scripts/export-stocks-research.mjs [--size 25] [--date YYYY-MM-DD] [--stdout]
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const { secTickerMap, secTicker, getSecRecord } = await import("../lib/edgar.ts");
const { CHAT_MODEL } = await import("./lib/chat-ops.mjs");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "ops", "chat-input");
const METRICS = [
  ["revenue", "Revenue"],
  ["operating_income", "Operating income"],
  ["net_income", "Net income"],
  ["eps_diluted", "Diluted EPS"],
];

const mn = (v) => (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 });
const addMonths = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  // Snap to the end of the month n months later (fiscal quarters end on or near a month end).
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).toISOString().slice(0, 10);
};

/** The companies still to research, in ticker order. Pure. */
export function remainingUniverse(tokens, externals, secTickers, handedOver = new Set()) {
  const done = new Set(externals.filter((c) => c.series === "stocks-us").map((c) => String(c.ticker).toUpperCase()));
  for (const t of handedOver) done.add(t);
  const pending = new Set(externals.filter((c) => c.status === "pending").map((c) => String(c.ticker).toUpperCase()));
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    const ticker = String(t.ticker).toUpperCase();
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    if (/ETF|Fund|Trust/i.test(String(t.asset_type ?? ""))) continue;
    if (!secTickers.has(secTicker(ticker))) continue;
    if (done.has(ticker) || pending.has(ticker)) continue;
    out.push({ ticker, name: t.name });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function companyBlock(c, sec) {
  const L = [`### ${c.ticker} — ${sec?.company ?? c.name}`, ""];
  if (!sec || Object.keys(sec.financials).length === 0) {
    L.push("EDGAR に四半期の数字がない（新規上場・外国企業など）。条件を置けなければ items に入れない。", "");
    return { text: L.join("\n"), lastEnd: null };
  }
  const f = sec.financials;
  const ends = [...new Set(METRICS.flatMap(([k]) => (f[k]?.quarterly ?? []).map((v) => v.end)))].sort().reverse().slice(0, 4);
  const annualEnd = f.revenue?.annual?.[0]?.end ?? null;
  L.push(`| 四半期末 | ${METRICS.map(([, l]) => l + (l === "Diluted EPS" ? " (USD)" : " (USD mn)")).join(" | ")} |`);
  L.push(`| --- | ${METRICS.map(() => "---").join(" | ")} |`);
  for (const e of ends) {
    const cells = METRICS.map(([k]) => {
      const v = f[k]?.quarterly?.find((x) => x.end === e);
      return v ? (k === "eps_diluted" ? String(v.value) : mn(v.value)) : "—";
    });
    L.push(`| ${e} | ${cells.join(" | ")} |`);
  }
  const lastEnd = [ends[0], annualEnd].filter(Boolean).sort().pop();
  const recent = sec.filings.find((x) => x.form === "10-Q" || x.form === "10-K");
  L.push("");
  if (annualEnd && annualEnd >= (ends[0] ?? "")) L.push(`直近の通期（10-K）の期末：${annualEnd}`);
  if (recent) L.push(`直近の定期報告：${recent.form}（${recent.filed} 提出）${recent.url}`);
  L.push(lastEnd ? `次の四半期末の目安：${addMonths(lastEnd, 3)}（会社の会計年度で確かめる）` : "次の四半期末の目安：不明（EDGAR に四半期の期末がない。会社の開示で確かめる）", "");
  return { text: L.join("\n"), lastEnd };
}

function render(batch, blocks, today, n) {
  const L = [
    `# 米国株リサーチ ${today} — 第 ${n} 回（${batch.length} 社）`,
    "",
    "各社に、次に発表される四半期について **条件を 1 つ** 置く。判定は人もモデルも使わず、10-Q / 10-K の XBRL の数字と基準を機械的に比べる（scripts/judge-stocks-edgar.mjs）。",
    "",
    "## 決まり",
    "",
    "- metric は `revenue` / `operating_income` / `net_income` / `eps_diluted` のどれか 1 つ。ほかの数字（受注残・ARR・セグメント売上など）は使わない。",
    "- threshold は、会社のガイダンス（決算発表・決算説明会・8-K）を根拠にする。ガイダンスがなければ、下の実績から根拠を書いて置く。根拠は basis に 1〜2 文、出どころの URL を source_url に。",
    "- 単位：revenue / operating_income / net_income は **USD mn**（百万ドル）、eps_diluted は **USD per share**。",
    "- fiscal_period / fiscal_year は会社の会計年度で書く。**Q4（10-K で報告される期）に eps_diluted は使えない**（10-K は通期しか載らず、EPS は引き算で出せない）。",
    "- period_end はその四半期の末日。target_date は決算発表の予定日（会社が公表していれば confirmed、なければ過去の発表日から推定して estimated）。",
    "- 条件を置けない会社（ガイダンスも実績もない、上場廃止の予定など）は items に入れない。無理に作らない。",
    "- 表に第 4 四半期の行がないことがある：10-K は通期しか載せないため。判定では「通期 − 9 か月累計」で出す。",
    "",
    "## 返す JSON",
    "",
    "```json",
    JSON.stringify(
      {
        type: "stock_catalysts",
        author: CHAT_MODEL,
        items: [
          {
            ticker: "AAPL",
            company_name: "Apple Inc.",
            metric: "revenue",
            fiscal_period: "Q1",
            fiscal_year: 2027,
            period_end: "2026-12-26",
            operator: ">=",
            threshold: 138000,
            basis: "（例）会社ガイダンスの前年同期比の伸びを、前年同期の実績に掛けた値。",
            source_url: "https://www.sec.gov/…",
            target_date: "2027-01-29",
            date_confidence: "estimated",
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "取り込み：`node scripts/import-from-chat.mjs <answer.json>`",
    "",
    "## 会社（数字は EDGAR の XBRL、提出されたまま）",
    "",
    ...blocks,
  ];
  return L.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const size = Number(opt("--size", 25));
  const today = opt("--date", new Date().toISOString().slice(0, 10));

  const solana = JSON.parse(await readFile(path.join(ROOT, "data", "solana-stocks.json"), "utf8"));
  const externals = JSON.parse(await readFile(path.join(ROOT, "data", "external-catalysts.json"), "utf8"));
  const secTickers = await secTickerMap();
  // Companies already handed to the chat in an earlier batch are not handed over
  // again, whether or not it set a condition (it may have left one out on purpose).
  const handedOver = new Set();
  for (const f of await readdir(OUT_DIR).catch(() => [])) {
    if (!f.startsWith("stocks-research-")) continue;
    for (const m of (await readFile(path.join(OUT_DIR, f), "utf8")).matchAll(/^### (\S+) — /gm)) handedOver.add(m[1]);
  }
  const all = remainingUniverse(solana.tokens, externals, secTickers, handedOver);
  const batch = all.slice(0, size);
  if (batch.length === 0) {
    console.log("nothing left to research");
    return;
  }

  const blocks = [];
  for (const c of batch) {
    // Sequential, to stay well under SEC's 10 requests/second.
    const sec = await getSecRecord(c.ticker).catch(() => null);
    blocks.push(companyBlock(c, sec).text);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const existing = (await readdir(OUT_DIR)).filter((f) => f.startsWith(`stocks-research-${today}-`)).length;
  const n = existing + 1;
  const md = render(batch, blocks, today, n);
  if (args.includes("--stdout")) {
    process.stdout.write(md);
    return;
  }
  const out = path.join(OUT_DIR, `stocks-research-${today}-${String(n).padStart(2, "0")}.md`);
  await writeFile(out, md, "utf8");
  console.log(`${out} — ${batch.length} companies; ${all.length - batch.length} left after this batch`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
