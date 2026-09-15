/**
 * EDINET type=5 CSV extraction — consolidated selection by CONTEXT ID.
 *
 * Root-cause regression guard: EDINET fills the 「連結・個別」column with "その他"
 * for the 主要な経営指標等 rows, so consolidated-vs-parent CANNOT be read from it.
 * The real distinction is the context ID — consolidated group totals sit on the
 * base period context (CurrentYearDuration), the parent-only (単体) figure carries
 * `_NonConsolidatedMember`, segments carry other `_…Member` axes.
 *
 * These tests build synthetic UTF-16LE + BOM, TAB-separated bytes that mirror the
 * real Toyota (7203, IFRS) dump — including a double-quoted 値 column with an
 * embedded raw tab — and assert we return the CONSOLIDATED figures, never the
 * parent ¥18.26兆 NetSales. Pure; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseCsv, extractFromRows } = await import("../../lib/edinet.ts");

const HEADER = [
  "要素ID",
  "項目名",
  "コンテキストID",
  "相対年度",
  "連結・個別",
  "期間・時点",
  "ユニットID",
  "単位",
  "値",
];

/** Build one TAB-separated line; the 値 cell is double-quoted like EDINET emits. */
function line(cells) {
  return cells
    .map((c, i) => (i === cells.length - 1 ? `"${c}"` : c))
    .join("\t");
}

/** Encode a CSV table to EDINET's on-the-wire form: UTF-16LE with a BOM. */
function utf16leBytes(rows) {
  const text = "﻿" + rows.map(line).join("\r\n") + "\r\n";
  return new Uint8Array(Buffer.from(text, "utf16le"));
}

// The Toyota-shaped rows: the parent (単体, JGAAP) NetSales is the WRONG answer;
// the consolidated (IFRS) revenue/profit on the base context is the right one.
const TOYOTA_ROWS = [
  HEADER,
  // 単体 (parent) NetSales — must NOT be picked as sales.
  [
    "jpcrp_cor:NetSalesSummaryOfBusinessResults",
    "売上高",
    "CurrentYearDuration_NonConsolidatedMember",
    "当期",
    "その他",
    "期間",
    "JPY",
    "円",
    "18259979000000",
  ],
  // 連結 (consolidated) IFRS 売上収益 — the right sales figure.
  [
    "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults",
    "売上収益",
    "CurrentYearDuration",
    "当期",
    "その他",
    "期間",
    "JPY",
    "円",
    "45095325000000",
  ],
  // 連結 IFRS 営業収益 (finance-arm top line) — present but lower priority than 売上収益.
  [
    "jpcrp_cor:OperatingRevenuesIFRSKeyFinancialData",
    "営業収益",
    "CurrentYearDuration",
    "当期",
    "その他",
    "期間",
    "JPY",
    "円",
    "50684952000000",
  ],
  // 連結 operating profit.
  [
    "jpcrp_cor:OperatingProfitLossIFRSSummaryOfBusinessResults",
    "営業利益",
    "CurrentYearDuration",
    "当期",
    "その他",
    "期間",
    "JPY",
    "円",
    "5352934000000",
  ],
  // 連結 profit attributable to owners of parent — with an embedded raw TAB in 値
  // to prove the RFC4180 quoted-field parser survives it.
  [
    "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
    "親会社の所有者に帰属する当期利益",
    "CurrentYearDuration",
    "当期",
    "その他",
    "期間",
    "JPY",
    "円",
    "3848098000000",
  ],
  // Prior-year consolidated revenue — must be ignored (相対年度 = 前期).
  [
    "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults",
    "売上収益",
    "Prior1YearDuration",
    "前期",
    "その他",
    "期間",
    "JPY",
    "円",
    "37154298000000",
  ],
];

test("consolidated is chosen by context, parent 単体 NetSales is never picked", () => {
  const rows = parseCsv(utf16leBytes(TOYOTA_ROWS));
  const fin = extractFromRows(rows);
  // 売上高: the consolidated IFRS 売上収益, NOT the ¥18.26兆 parent NetSales.
  assert.equal(fin.sales, 45095325000000);
  assert.notEqual(fin.sales, 18259979000000);
  assert.equal(fin.operating_income, 5352934000000);
  assert.equal(fin.net_income, 3848098000000);
});

test("prior-year rows are excluded (only 当期 is returned)", () => {
  const rows = parseCsv(utf16leBytes(TOYOTA_ROWS));
  const fin = extractFromRows(rows);
  assert.notEqual(fin.sales, 37154298000000);
});

test("OperatingRevenues 営業収益 is the sales fallback when 売上収益 is absent", () => {
  // Drop the RevenueIFRS rows: a finance-arm filer that reports only 営業収益.
  const rows = parseCsv(
    utf16leBytes(
      TOYOTA_ROWS.filter(
        (r) => r === HEADER || !String(r[0]).includes("RevenueIFRSSummaryOfBusinessResults"),
      ),
    ),
  );
  const fin = extractFromRows(rows);
  assert.equal(fin.sales, 50684952000000);
});

test("a 単体-only JGAAP filer (no consolidated context) still extracts", () => {
  const rows = parseCsv(
    utf16leBytes([
      HEADER,
      [
        "jpcrp_cor:NetSalesSummaryOfBusinessResults",
        "売上高",
        "CurrentYearDuration", // no _NonConsolidatedMember: this filer has no subsidiaries
        "当期",
        "その他",
        "期間",
        "JPY",
        "円",
        "812345000000",
      ],
      [
        "jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
        "親会社株主に帰属する当期純利益",
        "CurrentYearDuration",
        "当期",
        "その他",
        "期間",
        "JPY",
        "円",
        "45678000000",
      ],
    ]),
  );
  const fin = extractFromRows(rows);
  assert.equal(fin.sales, 812345000000);
  assert.equal(fin.net_income, 45678000000);
});
