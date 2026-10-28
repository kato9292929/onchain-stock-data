#!/usr/bin/env node
/**
 * Refresh data/solana-stocks.json — tokenized stocks issued on Solana.
 *
 *   xStocks (Backed / Kraken)  https://xstocks.fi/us/products
 *                              (the product list is embedded in the page)
 *   Ondo Global Markets        https://docs.ondo.finance/addresses
 *                              (links the issuer's own token CSV; we follow it)
 *
 * Both are the issuers' own public pages. No API key, no paid data API, no
 * web search, no model call: this costs nothing to run, which is why it may
 * have a weekly schedule at all.
 *
 * A source that fails — unreachable, or parsed into suspiciously few rows —
 * keeps its previous rows (and their old fetched_at), and the file records
 * the failure. One bad week must not empty the list.
 *
 *   node scripts/refresh-solana-stocks.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(process.cwd(), "data", "solana-stocks.json");

export const XSTOCKS_URL = "https://xstocks.fi/us/products";
export const ONDO_DOCS_URL = "https://docs.ondo.finance/addresses";
export const ISSUERS = {
  xstocks: "xStocks (Backed / Kraken)",
  ondo: "Ondo Global Markets",
};
/** Below this, a parse is treated as broken rather than as a real delisting. */
export const MIN_ROWS = { xstocks: 200, ondo: 100 };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UA = "onchain-stock-data/refresh-solana-stocks (+https://osd-coral.vercel.app)";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * The xStocks product page embeds every product as
 *   {"slug":…,"name":…,"symbol":"NVDAx","iconUrl":…,"addresses":{…,"solana":"Xs…",…}}
 * Pure, so a saved page can be tested.
 */
export function parseXstocks(html, { fetchedAt, sourceUrl = XSTOCKS_URL }) {
  const rx =
    /\{"slug":"([^"]+)","name":"([^"]+)","symbol":"([^"]+)","iconUrl":"[^"]*","addresses":\{([^}]*)\}\}/g;
  const out = new Map();
  for (const m of html.matchAll(rx)) {
    const [, , name, symbol, addrs] = m;
    const mint = addrs.match(/"solana":"([^"]+)"/)?.[1];
    if (!mint || !BASE58.test(mint)) continue;
    // Underlying ticker: the symbol without its trailing "x" (NVDAx → NVDA,
    // BRK.Bx → BRK.B, ADM.GBx → ADM.GB for the London line).
    const ticker = symbol.replace(/x$/, "");
    if (!ticker) continue;
    out.set(symbol, {
      ticker,
      symbol,
      name: name.replace(/\s*xStock$/i, "").trim(),
      issuer: ISSUERS.xstocks,
      asset_type: null,
      solana_mint: mint,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
    });
  }
  return [...out.values()];
}

/** Minimal RFC 4180 CSV reader (quoted fields, embedded commas/newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** The token CSV the Ondo addresses page links to, as a direct download. */
export function ondoCsvUrl(docsHtml) {
  const m = docsHtml.match(/https:\/\/www\.dropbox\.com\/scl\/fi\/[^"`'\s<>]+?Ondo-GM-Tokens[^"`'\s<>]*/);
  if (!m) return null;
  const url = m[0].replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
  return url.match(/[?&]dl=\d/) ? url.replace(/([?&])dl=\d/, "$1dl=1") : `${url}&dl=1`;
}

/** Stocks and ETFs only: USDon (currency) and the managed portfolios are not stocks. */
export function parseOndo(csvText, { fetchedAt, sourceUrl }) {
  const out = new Map();
  for (const r of parseCsv(csvText)) {
    const mint = r["Solana Deployed Address"];
    const type = r["Type"];
    const ticker = r["Stock Ticker"];
    if (!mint || !BASE58.test(mint)) continue;
    if (type !== "Stock" && type !== "ETF") continue;
    if (!ticker) continue;
    out.set(r["Symbol"], {
      ticker: ticker.toUpperCase(),
      symbol: r["Symbol"],
      name: r["Stock Name"] || r["Name"],
      issuer: ISSUERS.ondo,
      asset_type: r["Type Detail"] || type,
      solana_mint: mint,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
    });
  }
  return [...out.values()];
}

/**
 * Merge this run's rows with last week's: a source that failed keeps its old
 * rows. Pure.
 */
export function mergeRefresh(previous, results, now) {
  const prevRows = Array.isArray(previous?.tokens) ? previous.tokens : [];
  const tokens = [];
  const sources = {};
  for (const [key, issuer] of Object.entries(ISSUERS)) {
    const r = results[key];
    const ok = r && !r.error && r.rows.length >= MIN_ROWS[key];
    if (ok) {
      tokens.push(...r.rows);
      sources[key] = { issuer, url: r.url, fetched_at: now, ok: true, count: r.rows.length };
    } else {
      const kept = prevRows.filter((t) => t.issuer === issuer);
      tokens.push(...kept);
      sources[key] = {
        issuer,
        url: r?.url ?? previous?.sources?.[key]?.url ?? null,
        fetched_at: previous?.sources?.[key]?.fetched_at ?? null,
        ok: false,
        count: kept.length,
        last_error:
          r?.error ?? `parsed ${r?.rows.length ?? 0} rows, below the floor of ${MIN_ROWS[key]}`,
        last_attempt_at: now,
      };
    }
  }
  tokens.sort((a, b) =>
    a.ticker === b.ticker ? (a.issuer < b.issuer ? -1 : 1) : a.ticker < b.ticker ? -1 : 1,
  );
  return {
    source: "solana-tokenized-stocks",
    note:
      "Tokenized stocks issued on Solana, from each issuer's own public list. Refreshed weekly by " +
      "scripts/refresh-solana-stocks.mjs (no paid API). A source that fails keeps its previous rows; " +
      "each row carries its own source_url and fetched_at. Not investment advice.",
    updated_at: now,
    sources,
    tokens,
  };
}

async function main() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    /* first run */
  }

  const results = {};
  try {
    const html = await fetchText(XSTOCKS_URL);
    results.xstocks = { url: XSTOCKS_URL, rows: parseXstocks(html, { fetchedAt: today }) };
  } catch (e) {
    results.xstocks = { url: XSTOCKS_URL, rows: [], error: e.message };
  }
  try {
    const docs = await fetchText(ONDO_DOCS_URL);
    const csvUrl = ondoCsvUrl(docs);
    if (!csvUrl) throw new Error(`no token CSV link on ${ONDO_DOCS_URL}`);
    const csv = await fetchText(csvUrl);
    // The row's source is the issuer's docs page — the CSV link carries a
    // per-share key and is only how that page publishes the list.
    results.ondo = { url: ONDO_DOCS_URL, rows: parseOndo(csv, { fetchedAt: today, sourceUrl: ONDO_DOCS_URL }) };
  } catch (e) {
    results.ondo = { url: ONDO_DOCS_URL, rows: [], error: e.message };
  }

  const next = mergeRefresh(previous, results, now);
  await writeFile(OUT, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  for (const [k, s] of Object.entries(next.sources)) {
    const line = `[solana-stocks] ${k}: ${s.ok ? "ok" : "FAILED, kept previous"} · ${s.count} rows`;
    if (s.ok) console.log(line);
    else console.warn(`::warning::${line} — ${s.last_error}`);
  }
  console.log(`[solana-stocks] wrote ${next.tokens.length} rows`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[solana-stocks] failed: ${e.message}`);
    process.exit(1);
  });
}
