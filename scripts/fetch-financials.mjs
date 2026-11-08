#!/usr/bin/env node
/**
 * Latest disclosed financials per company, extracted mechanically from the
 * filings themselves. No API key, no model, no estimate.
 *
 *   npm run fetch:financials            → data/financials.json
 *   npm run fetch:financials -- --all   also every tokenized-stock underlying
 *
 * US  SEC EDGAR XBRL companyfacts (data.sec.gov). Quarterly and annual
 *     revenue, operating income, net income and diluted EPS, each with the
 *     form (10-Q / 10-K), filed date and the filing's EDGAR URL. YoY is
 *     computed against the prior-year period as reported in the same filing.
 * JP  TDnet 決算短信 XBRL (Summary inline XBRL): 売上高・営業利益・経常利益・
 *     親会社株主に帰属する当期純利益, current and prior-year period, with the
 *     短信 PDF URL and the disclosure time. TDnet lists the last ~31 days, so
 *     each run adds what is new and keeps what earlier runs recorded.
 *
 * Universe: every company with a dated condition on record (US / JP Weekly,
 * Catalysts) — the companies whose paid views carry financials.
 *
 * A value the filing does not tag is null. Nothing is derived (no Q4 = FY −
 * 9M), nothing is guessed.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzip } from "./lib/zip.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "financials.json");
// SEC asks automated clients to identify themselves. A generic product name —
// never a personal address.
const SEC_UA = "OnchainStockData research bot (osd.x402jp.com)";
const TDNET_UA = "OnchainStockData research bot (osd.x402jp.com)";
const TDNET = "https://www.release.tdnet.info/inbs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --reparse: read every 短信 still in the TDnet window again, even when the
// same disclosure is already on record (after a parser fix).
const REPARSE = process.argv.includes("--reparse");

// ── shared ────────────────────────────────────────────────────────────────

/** YoY % (1 dp). Null when either side is missing or the base is ≤ 0. */
export function yoy(cur, prior) {
  if (cur == null || prior == null || !(prior > 0)) return null;
  return Math.round(((cur - prior) / prior) * 1000) / 10;
}

const JP_CODE = /^\d{3}[0-9A-Z]$/;
const US_TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

/** Companies with a dated condition on record, by market. Pure. */
export function conditionUniverse({ usHistory, jpHistory, externals, irFair, solana }, { all = false } = {}) {
  const us = new Set();
  const jp = new Set();
  const weeks = (h) => [...(h?.current ? [h.current] : []), ...(h?.history ?? [])];
  for (const w of weeks(usHistory)) for (const h of w.holdings ?? []) us.add(String(h.ticker).toUpperCase());
  for (const w of weeks(jpHistory)) for (const h of w.holdings ?? []) jp.add(String(h.ticker).toUpperCase());
  for (const c of externals ?? []) {
    const t = String(c.ticker).toUpperCase();
    if (c.market === "JP" || JP_CODE.test(t)) jp.add(t);
    else us.add(t);
  }
  for (const c of irFair?.catalysts ?? []) (c.market === "US" ? us : jp).add(String(c.ticker).toUpperCase());
  if (all) for (const t of solana?.tokens ?? []) us.add(String(t.ticker).toUpperCase());
  return {
    us: [...us].filter((t) => US_TICKER.test(t)).sort(),
    jp: [...jp].filter((t) => JP_CODE.test(t)).sort(),
  };
}

// ── US: SEC companyfacts ──────────────────────────────────────────────────

const US_CONCEPTS = {
  revenue: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "RevenuesNetOfInterestExpense",
  ],
  operating_income: ["OperatingIncomeLoss"],
  net_income: ["NetIncomeLoss"],
  eps_diluted: ["EarningsPerShareDiluted"],
};
const SEC_FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT", "20-F", "40-F"]);

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const isQuarter = (f) => f.start && days(f.start, f.end) >= 80 && days(f.start, f.end) <= 100;
const isAnnual = (f) => f.start && days(f.start, f.end) >= 350 && days(f.start, f.end) <= 380;

export function edgarFilingUrl(cik, accn) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
}

/**
 * The latest period of one shape (quarter / annual) for one concept list,
 * with the prior-year value from the same filing. Pure.
 */
export function pickUsValue(usGaap, concepts, shape, cik) {
  let best = null;
  for (const concept of concepts) {
    const units = usGaap?.[concept]?.units;
    if (!units) continue;
    const unit = Object.keys(units)[0];
    const facts = units[unit].filter((f) => SEC_FORMS.has(f.form) && shape(f));
    if (facts.length === 0) continue;
    const end = facts.reduce((m, f) => (f.end > m ? f.end : m), "");
    // The filing that first disclosed this period.
    const cur = facts.filter((f) => f.end === end).sort((a, b) => (a.filed < b.filed ? -1 : 1))[0];
    if (best && best.cur.end >= cur.end) continue;
    const near = (f) => Math.abs(days(f.end, cur.end) - 365) <= 10;
    const prior =
      facts.find((f) => f.accn === cur.accn && near(f)) ??
      facts.filter(near).sort((a, b) => (a.filed < b.filed ? -1 : 1))[0] ??
      null;
    best = { concept, unit, cur, prior };
  }
  if (!best) return null;
  const { concept, unit, cur, prior } = best;
  return {
    value: cur.val,
    unit,
    period_start: cur.start,
    period_end: cur.end,
    prior_value: prior?.val ?? null,
    prior_period_end: prior?.end ?? null,
    yoy_pct: yoy(cur.val, prior?.val ?? null),
    concept: `us-gaap:${concept}`,
    form: cur.form,
    filed: cur.filed,
    source_url: edgarFilingUrl(cik, cur.accn),
    ...(prior && prior.accn !== cur.accn ? { prior_source_url: edgarFilingUrl(cik, prior.accn) } : {}),
  };
}

/** companyfacts JSON → {latest_quarter, latest_annual}. Pure. */
export function usFinancials(facts, cik) {
  const g = facts?.facts?.["us-gaap"];
  const build = (shape) => {
    const out = {};
    for (const [k, concepts] of Object.entries(US_CONCEPTS)) out[k] = pickUsValue(g, concepts, shape, cik);
    const any = Object.values(out).find(Boolean);
    return any ? { period_end: any.period_end, ...out } : null;
  };
  return { latest_quarter: build(isQuarter), latest_annual: build(isAnnual) };
}

async function secJson(url) {
  const res = await fetch(url, { headers: { "user-agent": SEC_UA }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

async function fetchUs(tickers, prev, fetchedAt) {
  const map = await secJson("https://www.sec.gov/files/company_tickers.json");
  const cikOf = new Map(Object.values(map ?? {}).map((r) => [String(r.ticker).toUpperCase().replace(/-/g, "."), r]));
  const out = {};
  const failed = [];
  for (const t of tickers) {
    const row = cikOf.get(t) ?? cikOf.get(t.replace(/\./g, "-"));
    if (!row) {
      failed.push({ ticker: t, reason: "no SEC registrant for this ticker" });
      if (prev[t]) out[t] = prev[t];
      continue;
    }
    const cik = String(row.cik_str).padStart(10, "0");
    const api = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    try {
      const facts = await secJson(api);
      const f = facts ? usFinancials(facts, cik) : { latest_quarter: null, latest_annual: null };
      out[t] = {
        market: "US",
        company: facts?.entityName ?? row.title,
        cik,
        source: "SEC EDGAR XBRL companyfacts",
        source_api_url: api,
        fetched_at: fetchedAt,
        ...f,
      };
      if (!f.latest_quarter && !f.latest_annual) failed.push({ ticker: t, reason: "no us-gaap income facts" });
    } catch (e) {
      failed.push({ ticker: t, reason: e.message });
      if (prev[t]) out[t] = prev[t];
    }
    await sleep(150); // SEC fair-access: well under 10 requests/second
  }
  return { out, failed };
}

// ── JP: TDnet 決算短信 XBRL ───────────────────────────────────────────────

/** One TDnet list page → disclosure rows. Pure. */
export function parseTdnetList(html, ymd) {
  const rows = [];
  for (const tr of html.split(/<tr>/i).slice(1)) {
    const cell = (cls) => tr.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</td>`))?.[1] ?? "";
    const code5 = cell("kjCode").trim();
    if (!/^\d{3}[0-9A-Z]\d$/.test(code5)) continue;
    const titleCell = cell("kjTitle");
    const pdf = titleCell.match(/href="([^"]+\.pdf)"/)?.[1] ?? null;
    const title = titleCell.replace(/<[^>]+>/g, "").trim();
    const zip = cell("kjXbrl").match(/href="([^"]+\.zip)"/)?.[1] ?? null;
    rows.push({
      code: code5.slice(0, 4),
      company: cell("kjName").trim(),
      title,
      time: cell("kjTime").trim(),
      date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      pdf_url: pdf ? `${TDNET}/${pdf}` : null,
      xbrl_url: zip ? `${TDNET}/${zip}` : null,
    });
  }
  return rows;
}

const JP_NAMES = {
  revenue: ["NetSales", "Revenue", "Revenues", "OperatingRevenues", "Sales", "NetRevenues", "OrdinaryRevenues"],
  operating_income: ["OperatingIncome", "OperatingProfit"],
  ordinary_income: ["OrdinaryIncome"],
  net_income: ["ProfitAttributableToOwnersOfParent", "NetIncomeAttributableToOwnersOfParent", "NetIncome", "Profit"],
};

/** Summary inline XBRL → current / prior period figures in JPY. Pure. */
export function parseTanshin(html) {
  const facts = [];
  // A nil fact is self-closing (<ix:nonFraction … />); it must not swallow the next fact.
  for (const m of html.matchAll(/<ix:nonFraction(\s[^>]*?)(?<!\/)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const attrs = m[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1] ?? "";
    const ctx = attrs.match(/\bcontextRef="([^"]+)"/)?.[1] ?? "";
    const scale = Number(attrs.match(/\bscale="(-?\d+)"/)?.[1] ?? 0);
    const neg = /\bsign="-"/.test(attrs);
    const text = m[2].replace(/<[^>]+>/g, "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(text)) continue;
    const local = name.replace(/^[^:]+:/, "").replace(/(IFRS|US|JMIS)$/, "");
    const v = Number(text) * 10 ** scale;
    facts.push({ local, ctx, value: neg ? -v : v });
  }
  const ctxRe = (when, basis) => new RegExp(`^${when}(AccumulatedQ(\\d)|Year)Duration_${basis}Member_ResultMember$`);
  for (const basis of ["Consolidated", "NonConsolidated"]) {
    const cur = facts.filter((f) => ctxRe("Current", basis).test(f.ctx));
    if (cur.length === 0) continue;
    const q = cur[0].ctx.match(ctxRe("Current", basis))[2];
    const prior = facts.filter((f) => ctxRe("Prior", basis).test(f.ctx));
    const pick = (list, names) => {
      for (const n of names) {
        const f = list.find((x) => x.local === n);
        if (f) return Math.round(f.value);
      }
      return null;
    };
    const out = { period: q ? `Q${q}_YTD` : "FY", basis: basis === "Consolidated" ? "consolidated" : "non_consolidated" };
    for (const [k, names] of Object.entries(JP_NAMES)) {
      const c = pick(cur, names);
      const p = pick(prior, names);
      out[k] = c == null && p == null ? null : { value: c, unit: "JPY", prior_value: p, yoy_pct: yoy(c, p) };
    }
    return out;
  }
  return null;
}

const standardOf = (title) =>
  /IFRS/.test(title) ? "IFRS" : /米国基準/.test(title) ? "US GAAP" : /日本基準/.test(title) ? "JGAAP" : null;

async function tdnetText(url) {
  const res = await fetch(url, { headers: { "user-agent": TDNET_UA }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.text();
}

async function fetchJp(codes, prev, fetchedAt, today) {
  const want = new Set(codes);
  const latest = new Map();
  let pages = 0;
  for (let d = 0; d <= 31; d += 1) {
    const ymd = new Date(Date.parse(`${today}T00:00:00Z`) - d * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    for (let p = 1; p <= 40; p += 1) {
      const html = await tdnetText(`${TDNET}/I_list_${String(p).padStart(3, "0")}_${ymd}.html`);
      await sleep(200);
      if (!html) break;
      pages += 1;
      for (const r of parseTdnetList(html, ymd)) {
        if (!want.has(r.code) || !r.xbrl_url || !/決算短信/.test(r.title)) continue;
        const key = `${r.date}T${r.time}`;
        const cur = latest.get(r.code);
        if (!cur || `${cur.date}T${cur.time}` < key) latest.set(r.code, r);
      }
      if (!new RegExp(`I_list_${String(p + 1).padStart(3, "0")}_${ymd}`).test(html)) break;
    }
  }
  const out = {};
  const failed = [];
  for (const code of codes) {
    const r = latest.get(code);
    const old = prev[code];
    const disclosedAt = r ? `${r.date}T${r.time}:00+09:00` : null;
    if (!r || (!REPARSE && old?.latest?.disclosed_at && old.latest.disclosed_at >= disclosedAt)) {
      if (old) out[code] = old;
      continue;
    }
    try {
      const res = await fetch(r.xbrl_url, { headers: { "user-agent": TDNET_UA }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const files = unzip(Buffer.from(await res.arrayBuffer()), (n) => /Summary\/.*ixbrl\.htm$/.test(n));
      const html = [...files.values()][0]?.toString("utf8");
      const figures = html ? parseTanshin(html) : null;
      if (!figures) throw new Error("no result figures in the summary XBRL");
      const src = { source_url: r.pdf_url, disclosed_at: disclosedAt };
      for (const k of Object.keys(JP_NAMES)) if (figures[k]) figures[k] = { ...figures[k], ...src };
      out[code] = {
        market: "JP",
        company: r.company,
        source: "TDnet 決算短信 XBRL",
        fetched_at: fetchedAt,
        latest: {
          title: r.title,
          accounting_standard: standardOf(r.title),
          disclosed_at: disclosedAt,
          document_url: r.pdf_url,
          xbrl_url: r.xbrl_url,
          ...figures,
        },
      };
    } catch (e) {
      failed.push({ ticker: code, reason: e.message });
      if (old) out[code] = old;
    }
    await sleep(200);
  }
  return { out, failed, pages, found: latest.size };
}

// ── main ──────────────────────────────────────────────────────────────────

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const all = process.argv.includes("--all");
  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);
  const prev = (await readJson("data/financials.json", { companies: {} })).companies ?? {};
  const uni = conditionUniverse(
    {
      usHistory: await readJson("data/portfolio-history.json", null),
      jpHistory: await readJson("data/jp-portfolio-history.json", null),
      externals: await readJson("data/external-catalysts.json", []),
      irFair: await readJson("data/ir-fair-2026-catalysts.json", { catalysts: [] }),
      solana: await readJson("data/solana-stocks.json", { tokens: [] }),
    },
    { all },
  );

  const us = await fetchUs(uni.us, prev, fetchedAt);
  const jp = await fetchJp(uni.jp, prev, fetchedAt, today);

  // Keep anything an earlier run recorded that this run did not touch.
  const companies = { ...prev, ...us.out, ...jp.out };
  const sorted = Object.fromEntries(Object.entries(companies).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        updated_at: fetchedAt,
        sources: {
          us: "https://data.sec.gov/api/xbrl/companyfacts/",
          jp: "https://www.release.tdnet.info/inbs/I_main_00.html",
        },
        last_run: {
          us_requested: uni.us.length,
          us_failed: us.failed,
          jp_requested: uni.jp.length,
          jp_tdnet_pages: jp.pages,
          jp_found_in_window: jp.found,
          jp_failed: jp.failed,
        },
        companies: sorted,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const withJp = Object.values(sorted).filter((c) => c.market === "JP").length;
  console.log(
    `[financials] US ${uni.us.length} requested, ${us.failed.length} failed · JP ${uni.jp.length} requested, ` +
      `${jp.found} 短信 in the TDnet window (${jp.pages} pages), ${jp.failed.length} failed · ${withJp} JP on record`,
  );
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[financials] failed: ${e.message}`);
    process.exit(1);
  });
}
