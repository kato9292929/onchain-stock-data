/**
 * Primary-source excerpts for the chat export: the XBRL is read as filed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conditionTerms, ixFacts, memberLabels, orderLines, pickPages, segmentRows, summaryFigures } from "../export-primary.mjs";

const nf = (name, ctx, v, extra = "") => `<ix:nonFraction name="tse-ed-t:${name}" contextRef="${ctx}" unitRef="JPY" scale="6"${extra}>${v}</ix:nonFraction>`;
const SUMMARY = [
  nf("NetSales", "CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember", "262,546"),
  nf("NetSales", "PriorAccumulatedQ2Duration_ConsolidatedMember_ResultMember", "195,485"),
  nf("NetSales", "CurrentYearDuration_ConsolidatedMember_ForecastMember", "565,000"),
  nf("OperatingIncome", "CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember", "60,116"),
  nf("OperatingIncome", "CurrentYearDuration_ConsolidatedMember_UpperMember", "999,999"),
  '<ix:nonNumeric name="tse-ed-t:CorrectionOfConsolidatedFinancialForecastInThisQuarter" contextRef="CurrentYearDuration_ConsolidatedMember_ForecastMember">有</ix:nonNumeric>',
].join("");

test("summary: current, prior-year and the forecast (not the range ends), with the revision flag", () => {
  const s = summaryFigures(ixFacts(SUMMARY));
  assert.equal(s.period, "第2四半期累計");
  assert.equal(s.basis, "連結");
  assert.deepEqual(s.rows[0], { label: "売上高", current: 262546000000, prior: 195485000000, forecast: 565000000000 });
  assert.equal(s.rows[1].forecast, null, "UpperMember is a range end, not the forecast");
  assert.equal(s.revision, "有");
});

test("segments: numbers nested inside a text-block table are still read; labels come from the linkbase", () => {
  const html =
    '<ix:nonNumeric name="jpcrp_cor:NotesSegmentInformationTextBlock" contextRef="Prior1InterimDuration"><table>' +
    nf("NetSales", "Prior1InterimDuration_tse-x-40620ElectronicsReportableSegmentMember", "113,553") +
    "</table></ix:nonNumeric>" +
    nf("NetSales", "InterimDuration_tse-x-40620ElectronicsReportableSegmentMember", "172,551") +
    nf("OperatingIncome", "InterimDuration_ReconcilingItemsMember", "73");
  const labels = memberLabels(
    '<link:label xlink:label="tse-x-40620_ElectronicsReportableSegmentMember_label" xlink:role="http://www.xbrl.org/2003/role/label">電子</link:label>',
  );
  assert.deepEqual(segmentRows(ixFacts(html), labels), [
    { segment: "電子", metric: "NetSales", current: 172551000000, prior: 113553000000 },
    { segment: "調整額", metric: "OperatingIncome", current: 73000000, prior: null },
  ]);
});

test("pages: the ones that use the condition's own terms come first, at most four", () => {
  const terms = conditionTerms("10/30頃の1Q決算でEUVマスク検査装置受注が前四半期比増加なら当たり");
  assert.ok(terms.includes("EUV") && terms.includes("マスク"));
  const pages = [
    { page: 1, text: "会社概要" },
    { page: 2, text: "EUV マスク検査装置の受注高" },
    { page: 3, text: "受注" },
    { page: 4, text: "マスク" },
    { page: 5, text: "EUV" },
    { page: 6, text: "EUV マスク 受注 価格" },
  ];
  assert.deepEqual(pickPages(pages, terms).map((p) => p.page), [6, 2, 5, 4]);
});

test("orders: only lines that state 受注高 / 受注残高 with a number", () => {
  assert.deepEqual(orderLines("受注高 40,369 百万円\n受注の状況について\n受注残高は 1,234億円\n売上高 1"), [
    "受注高 40,369 百万円",
    "受注残高は 1,234億円",
  ]);
});

test("a nil fact (self-closing) does not swallow the next fact", () => {
  const html =
    '<ix:nonFraction name="tse-ed-t:OrdinaryIncome" contextRef="CurrentYearDuration_ConsolidatedMember_ForecastMember" xsi:nil="true"/>' +
    nf("NetSales", "CurrentYearDuration_ConsolidatedMember_ForecastMember", "290,000") +
    '<ix:nonNumeric name="tse-ed-t:CorrectionOfConsolidatedFinancialForecastInThisQuarter" contextRef="x"><span>無</span></ix:nonNumeric>';
  const facts = ixFacts(html);
  assert.deepEqual(facts.filter((f) => f.numeric).map((f) => [f.name, f.value]), [["NetSales", 290000000000]]);
  assert.equal(facts.find((f) => !f.numeric).value, "無");
});
