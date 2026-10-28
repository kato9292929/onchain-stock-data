import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseXstocks,
  parseOndo,
  parseCsv,
  ondoCsvUrl,
  mergeRefresh,
  MIN_ROWS,
  ISSUERS,
} from "../refresh-solana-stocks.mjs";
import {
  classifySolanaStockAccess,
  conditionsFor,
  freeBody,
  fullBody,
  nextEarnings,
} from "../../lib/solana-stocks.ts";

const XS_PAGE =
  'x{"slug":"nvidia-xstock","name":"NVIDIA xStock","symbol":"NVDAx","iconUrl":"https://cdn/x.png","addresses":{"ethereum":"0xc8","solana":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh","arc":null}}' +
  ',{"slug":"berkshire","name":"Berkshire Hathaway xStock","symbol":"BRK.Bx","iconUrl":"","addresses":{"solana":"XsBRKbBRKbBRKbBRKbBRKbBRKbBRKbBRKbBRKbBRKb1"}}' +
  ',{"slug":"nosol","name":"No Solana xStock","symbol":"NOSx","iconUrl":"","addresses":{"solana":null}}';

test("xStocks: the embedded product list becomes ticker / mint rows", () => {
  const rows = parseXstocks(XS_PAGE, { fetchedAt: "2026-10-28" });
  assert.deepEqual(rows.map((r) => [r.ticker, r.symbol, r.name]), [
    ["NVDA", "NVDAx", "NVIDIA"],
    ["BRK.B", "BRK.Bx", "Berkshire Hathaway"],
  ]);
  assert.equal(rows[0].solana_mint, "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
  assert.equal(rows[0].source_url, "https://xstocks.fi/us/products");
  assert.equal(rows[0].fetched_at, "2026-10-28");
});

const CSV =
  "﻿Name,Symbol,Solana Deployed Address,Stock Name,Stock Ticker,Type Detail,Type,Description\n" +
  "Ondo U.S. Dollar Token,USDon,ZPFtoCe7WWqG4N3ZFRccS8T9SMBeHsd1Vmgv2i7ondo,,,,Currency,x\n" +
  'Apple (Ondo Tokenized),AAPLon,123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo,Apple,AAPL,Common Stock,Stock,"multi\nline, with comma"\n' +
  "Mag 7,MAG7Xon,9wYZetvT8J2ptfsRca5gzLBGvcUug38mp9yT3xaondo,,,Basket,Portfolio,x\n";

test("Ondo: stocks and ETFs only, quoted multi-line fields survive", () => {
  assert.equal(parseCsv(CSV).length, 3);
  const rows = parseOndo(CSV, { fetchedAt: "2026-10-28", sourceUrl: "https://docs.ondo.finance/addresses" });
  assert.deepEqual(rows.map((r) => [r.ticker, r.symbol, r.asset_type]), [["AAPL", "AAPLon", "Common Stock"]]);
  assert.equal(rows[0].issuer, ISSUERS.ondo);
});

test("Ondo: the CSV link is found on the docs page and turned into a download", () => {
  const html =
    "children:_jsx(_components.a,{href:`https://www.dropbox.com/scl/fi/abc/EXTERNAL-Ondo-GM-Tokens-Ondo-GM-Tokens.csv?rlkey=k\\u0026e=2\\u0026dl=0`,";
  assert.equal(
    ondoCsvUrl(html),
    "https://www.dropbox.com/scl/fi/abc/EXTERNAL-Ondo-GM-Tokens-Ondo-GM-Tokens.csv?rlkey=k&e=2&dl=1",
  );
  assert.equal(ondoCsvUrl("<html>no link</html>"), null);
});

test("a source that fails keeps last week's rows and says so", () => {
  const prev = {
    sources: { ondo: { url: "u", fetched_at: "2026-10-21T00:00:00Z" } },
    tokens: [
      { ticker: "AAPL", issuer: ISSUERS.ondo, fetched_at: "2026-10-21" },
      { ticker: "OLD", issuer: ISSUERS.xstocks, fetched_at: "2026-10-21" },
    ],
  };
  const xs = Array.from({ length: MIN_ROWS.xstocks }, (_, i) => ({ ticker: `T${i}`, issuer: ISSUERS.xstocks }));
  const next = mergeRefresh(prev, { xstocks: { url: "x", rows: xs }, ondo: { url: "u", rows: [], error: "HTTP 503" } }, "2026-10-28T00:00:00Z");
  assert.equal(next.sources.ondo.ok, false);
  assert.equal(next.sources.ondo.last_error, "HTTP 503");
  assert.ok(next.tokens.some((t) => t.ticker === "AAPL" && t.fetched_at === "2026-10-21"), "Ondo rows kept");
  assert.ok(!next.tokens.some((t) => t.ticker === "OLD"), "xStocks replaced by the fresh list");
  // A parse that comes back nearly empty is a broken parse, not 1,300 delistings.
  const thin = mergeRefresh(prev, { xstocks: { url: "x", rows: xs.slice(0, 3) }, ondo: { url: "u", rows: [] } }, "2026-10-28T00:00:00Z");
  assert.equal(thin.sources.xstocks.ok, false);
  assert.ok(thin.tokens.some((t) => t.ticker === "OLD"));
});

test("the committed list has both issuers, valid mints and per-row provenance", () => {
  const f = JSON.parse(readFileSync("data/solana-stocks.json", "utf8"));
  for (const issuer of Object.values(ISSUERS)) {
    assert.ok(f.tokens.filter((t) => t.issuer === issuer).length >= 100, issuer);
  }
  for (const t of f.tokens) {
    assert.match(t.solana_mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, t.symbol);
    assert.match(t.source_url, /^https:\/\//, t.symbol);
    assert.match(t.fetched_at, /^\d{4}-\d{2}-\d{2}$/, t.symbol);
  }
  const nvdax = f.tokens.find((t) => t.symbol === "NVDAx");
  assert.equal(nvdax.solana_mint, "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "matches data/stocks.json");
});

// ── the endpoint's views ──────────────────────────────────────────────────

const FILE = {
  updated_at: "2026-10-28T00:00:00Z",
  sources: {},
  tokens: [
    { ticker: "MSFT", symbol: "MSFTx", name: "Microsoft", issuer: ISSUERS.xstocks, asset_type: null, solana_mint: "XsMSFT", source_url: "https://xstocks.fi/us/products", fetched_at: "2026-10-28" },
    { ticker: "ZZZ", symbol: "ZZZon", name: "Zed", issuer: ISSUERS.ondo, asset_type: "Common Stock", solana_mint: "ZZZondo", source_url: "https://docs.ondo.finance/addresses", fetched_at: "2026-10-28" },
  ],
};
const REC = {
  usHistory: {
    current: {
      week_of: "2026-10-19",
      holdings: [{ ticker: "MSFT", target_date: "2026-10-28", target_date_source: "verified", target_date_confirmed: "2026-10-29", target_date_confirmed_source: "https://www.microsoft.com/en-us/investor", target_date_checked_at: "2026-10-28" }],
    },
    history: [{ week_of: "2026-10-12", holdings: [{ ticker: "MSFT", target_date: "2026-10-28" }] }],
  },
  usEvals: {
    evaluations: [
      { week_of: "2026-10-19", ticker: "MSFT", catalyst_target_date: "2026-10-28", success_condition: "Azure +35%", status: "pending", evaluated_at: null, evidence_url: null, reasoning: null },
      { week_of: "2026-10-12", ticker: "MSFT", catalyst_target_date: "2026-07-29", success_condition: "Azure +30%", status: "hit", evaluated_at: "2026-08-06T00:00:00Z", evidence_url: "https://e", reasoning: "r", verdict_history: [{ status: "miss" }] },
    ],
  },
  externals: [],
  signals: { signals: [{ id: "s1", claim: "c", tickers: ["msft"], source: "x", source_tier: "opinion", verified: false }] },
};

test("who pays: unknown 404s, no condition is free, a covered ticker is paid", () => {
  assert.equal(classifySolanaStockAccess("NOPE", FILE, REC), "not-found");
  assert.equal(classifySolanaStockAccess("zzz", FILE, REC), "free-only");
  assert.equal(classifySolanaStockAccess("MSFT", FILE, REC), "paid");
});

test("next earnings prefers the company's own date and says where it came from", () => {
  // The condition says 10-28 (the model's date); the IR page said 10-29.
  const ne = nextEarnings(conditionsFor("MSFT", REC), "2026-10-28");
  assert.deepEqual(
    [ne.date, ne.target_date_source, ne.source_url, ne.condition_id],
    ["2026-10-29", "verified", "https://www.microsoft.com/en-us/investor", "us:2026-10-19:MSFT"],
  );
  // An unchecked date is passed on as the model's, never dressed up as verified.
  const unchecked = structuredClone(REC);
  unchecked.usEvals.evaluations.push({ week_of: "2026-10-12", ticker: "MSFT", catalyst_target_date: "2026-10-28", success_condition: "x", status: "pending" });
  const m = nextEarnings(conditionsFor("MSFT", unchecked), "2026-10-28");
  assert.deepEqual([m.date, m.target_date_source, m.source_url], ["2026-10-28", "model", null]);
  assert.equal(nextEarnings(conditionsFor("MSFT", REC), "2026-11-01"), null);
});

test("the free view gives mint and deadline; the full view adds history and signals", () => {
  const free = freeBody("msft", FILE, REC, "2026-10-29", "https://osd");
  assert.equal(free.tokens[0].solana_mint, "XsMSFT");
  assert.equal(free.condition_count, 2);
  assert.equal(free.latest_verdict.status, "hit");
  assert.equal(free.full.url, "https://osd/api/solana-stocks/MSFT?view=full");
  assert.match(free.date_source_meaning, /'verified' = the date was read off/);
  assert.equal(free.conditions, undefined, "no condition text in the free view");

  const full = fullBody("MSFT", FILE, REC, "2026-10-29", "https://osd");
  assert.equal(full.conditions.length, 2);
  const judged = full.conditions.find((c) => c.status === "hit");
  assert.deepEqual(judged.evidence_urls, ["https://e"]);
  assert.deepEqual(judged.verdict_history, [{ status: "miss" }]);
  assert.equal(full.signals[0].verified, false);
  assert.equal(freeBody("ZZZ", FILE, REC, "2026-10-29", "https://osd").full, null);
});
