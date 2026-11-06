#!/usr/bin/env node
/**
 * Next earnings date per ticker, from primary sources only. No API key.
 *
 *   npm run check:earnings-dates      → data/earnings-dates.json
 *
 * Universe: the underlying of every tokenized stock on Solana
 * (data/solana-stocks.json) plus every ticker in the Catalysts and Weekly
 * records.
 *
 * Sources:
 *   JP  JPX 「決算発表予定日」 (every listed company's notified date, published
 *       by the exchange; https://www.jpx.co.jp/listing/event-schedules/financial-announcement/)
 *   US  the company's own announcement, where one is on record: the IR /
 *       press-release URL a date check read the date off (target_date_source
 *       "verified" in the Weekly records). There is no key-free bulk source of
 *       US company announcements, so the rest are left unverified.
 *
 * Status:
 *   confirmed      a future date, with the URL it was read from
 *   not_announced  JP only: JPX's lists were read and carry no future date
 *                  for the code — the company has not notified one
 *   unverified     no primary source could be checked (US without an
 *                  announcement on record, or the JPX fetch failed)
 *
 * A model-estimated date is never written here.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { excelDate, readXlsx } from "./lib/zip.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "earnings-dates.json");
export const JPX_INDEX = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html";
const UA = "OnchainStockData earnings-date check (osd.x402jp.com)";

export const JP_CODE = /^\d{3}[0-9A-Z]$/;
const US_TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

/** Every ticker this site serves, with its market. Pure. */
export function universe({ solana, usHistory, jpHistory, externals, irFair }) {
  const out = new Map();
  const add = (t, market) => {
    const k = String(t ?? "").trim().toUpperCase();
    if (!k) return;
    if (market === "JP" ? JP_CODE.test(k) : US_TICKER.test(k)) out.set(k, market);
  };
  for (const t of solana?.tokens ?? []) add(t.ticker, "US");
  const weeks = (h) => [...(h?.current ? [h.current] : []), ...(h?.history ?? [])];
  for (const w of weeks(usHistory)) for (const h of w.holdings ?? []) add(h.ticker, "US");
  for (const w of weeks(jpHistory)) for (const h of w.holdings ?? []) add(h.ticker, "JP");
  for (const c of externals ?? []) add(c.ticker, c.market === "JP" || JP_CODE.test(String(c.ticker)) ? "JP" : "US");
  for (const c of irFair?.catalysts ?? []) add(c.ticker, "JP");
  return out;
}

/** JPX schedule rows → code → [{date, period, source_url}]. Pure. */
export function parseJpxSchedule(rows, sourceUrl) {
  const out = new Map();
  for (const r of rows) {
    const date = /^\d{5}$/.test(r[0] ?? "") ? excelDate(r[0]) : null;
    const code = String(r[1] ?? "").trim();
    if (!date || !JP_CODE.test(code)) continue;
    const list = out.get(code) ?? [];
    list.push({ date, period: r[7] || null, source_url: sourceUrl });
    out.set(code, list);
  }
  return out;
}

/** Announcements read by a date check (Weekly records), ticker → [{date, source_url, checked_at}]. Pure. */
export function checkedAnnouncements(...histories) {
  const out = new Map();
  for (const h of histories) {
    for (const w of [...(h?.current ? [h.current] : []), ...(h?.history ?? [])]) {
      for (const x of w.holdings ?? []) {
        if (x.target_date_source !== "verified" || !x.target_date_confirmed_source) continue;
        const t = String(x.ticker).toUpperCase();
        const list = out.get(t) ?? [];
        list.push({
          date: x.target_date_confirmed ?? x.target_date,
          source_url: x.target_date_confirmed_source,
          checked_at: x.target_date_checked_at ?? null,
        });
        out.set(t, list);
      }
    }
  }
  return out;
}

/** One ticker's next earnings. Pure. */
export function resolveNext(ticker, market, { jpx, jpxOk, announced, today, checkedAt }) {
  const pick = (list) =>
    (list ?? []).filter((x) => x.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;
  if (market === "JP") {
    const j = pick(jpx.get(ticker));
    if (j) return { date: j.date, status: "confirmed", source_url: j.source_url, checked_at: checkedAt };
    const a = pick(announced.get(ticker));
    if (a) return { date: a.date, status: "confirmed", source_url: a.source_url, checked_at: a.checked_at ?? checkedAt };
    return jpxOk
      ? { date: null, status: "not_announced", source_url: null, checked_at: checkedAt }
      : { date: null, status: "unverified", source_url: null, checked_at: checkedAt };
  }
  const a = pick(announced.get(ticker));
  if (a) return { date: a.date, status: "confirmed", source_url: a.source_url, checked_at: a.checked_at ?? checkedAt };
  return { date: null, status: "unverified", source_url: null, checked_at: checkedAt };
}

async function fetchJpx() {
  const base = "https://www.jpx.co.jp";
  const res = await fetch(JPX_INDEX, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`JPX index HTTP ${res.status}`);
  const html = await res.text();
  const links = [...new Set([...html.matchAll(/href="([^"]+kessan[^"]*\.xlsx)"/g)].map((m) => m[1]))];
  if (links.length === 0) throw new Error("no schedule workbook linked from the JPX index");
  const merged = new Map();
  const files = [];
  for (const href of links) {
    const url = href.startsWith("http") ? href : `${base}${href}`;
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
    const rows = readXlsx(Buffer.from(await r.arrayBuffer()));
    const parsed = parseJpxSchedule(rows, url);
    for (const [code, list] of parsed) merged.set(code, [...(merged.get(code) ?? []), ...list]);
    files.push({ url, rows: [...parsed.values()].reduce((n, l) => n + l.length, 0) });
  }
  return { map: merged, files };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const files = {
    solana: await readJson("data/solana-stocks.json", { tokens: [] }),
    usHistory: await readJson("data/portfolio-history.json", null),
    jpHistory: await readJson("data/jp-portfolio-history.json", null),
    externals: await readJson("data/external-catalysts.json", []),
    irFair: await readJson("data/ir-fair-2026-catalysts.json", { catalysts: [] }),
  };
  const uni = universe(files);
  const announced = checkedAnnouncements(files.usHistory, files.jpHistory);

  let jpx = new Map();
  let jpxOk = false;
  let jpxInfo;
  try {
    const r = await fetchJpx();
    jpx = r.map;
    jpxOk = true;
    jpxInfo = { ok: true, index: JPX_INDEX, files: r.files };
  } catch (e) {
    jpxInfo = { ok: false, index: JPX_INDEX, error: e.message };
    console.warn(`::warning::JPX schedule unavailable: ${e.message}`);
  }

  const tickers = {};
  const counts = { confirmed: 0, not_announced: 0, unverified: 0 };
  const byMarket = { US: { ...counts }, JP: { ...counts } };
  for (const [t, market] of [...uni].sort()) {
    const r = resolveNext(t, market, { jpx, jpxOk, announced, today, checkedAt });
    tickers[t] = { market, ...r };
    counts[r.status] += 1;
    byMarket[market][r.status] += 1;
  }
  const out = {
    checked_at: checkedAt,
    sources: { jpx: jpxInfo, company_announcements_on_record: [...announced.keys()].length },
    counts,
    by_market: byMarket,
    tickers,
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`[earnings-dates] ${uni.size} tickers: ${JSON.stringify(counts)} · ${JSON.stringify(byMarket)}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[earnings-dates] failed: ${e.message}`);
    process.exit(1);
  });
}
