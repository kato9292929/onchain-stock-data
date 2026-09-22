import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, corsPreflight } from "@/lib/x402-route";
import { PER_CALL_PRICE } from "@/lib/x402";
import {
  getCompanyFinancials,
  dumpReportElements,
  FINANCIAL_WINDOW_DAYS,
  SOURCE_LABEL,
  PROCESSED_BY,
} from "@/lib/edinet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cold cache: the first request of the week scans a window of daily lists +
// downloads one report's CSV. Give it room; warm requests return in ms.
export const maxDuration = 60;

/**
 * PAID (x402 per-call, Solana mainnet exact-svm — same rail as /api/catalyst):
 * one company's LATEST disclosure from EDINET — filer name, doc id / type /
 * description, submission datetime and the accounting period, located from the
 * newest 有報・四半期・半期 report.
 *
 * The headline figures (sales / operating income / net income) are part of the
 * response shape but are NOT currently served: extraction is paused
 * (lib/edinet.ts `FINANCIALS_ENABLED = false`) because the candidate-element
 * approach shipped wrong values live, so they return null alongside
 * `financials_available:false` and `financials_note`. Figures are never
 * fabricated. Keep the paywall `description` below in step with this.
 *
 * Terms compliance: every payload carries `source` = "出典：金融庁 EDINET" and
 * `processed_by`. Data is fetched only via the official EDINET API v2; date
 * lists and per-report extractions are cached weekly.
 *
 * Priced at 1000 USDC base units (0.001 USDC), settled in USDC-SPL on Solana.
 */
async function handler(req: NextRequest): Promise<NextResponse> {
  // withX402 doesn't forward Next dynamic params — read the last path segment.
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  const code = decodeURIComponent(seg[seg.length - 1] ?? "").toUpperCase();
  const days = Math.min(
    400,
    Math.max(1, Number(url.searchParams.get("days")) || FINANCIAL_WINDOW_DAYS),
  );

  // Debug: dump the raw XBRL element rows of the latest report, to confirm the
  // real element IDs by fact. Unprocessed; same paywall as the main endpoint.
  if (url.searchParams.get("debug") === "elements") {
    const dump = await dumpReportElements(code, days);
    return NextResponse.json({
      source: SOURCE_LABEL,
      pipeline: "edinet-financials-v1",
      debug: true,
      note: "デバッグ用・未加工のXBRL要素ダンプ（当期・連結・JPY を優先表示）",
      code,
      doc: dump.doc,
      count: dump.count,
      elements: dump.elements,
    });
  }

  try {
    const fin = await getCompanyFinancials(code, days);
    return NextResponse.json({
      source: SOURCE_LABEL,
      processed_by: PROCESSED_BY,
      // Deploy marker — a one-line check that the financials pipeline is live.
      pipeline: "edinet-financials-v1",
      fetched_via: "EDINET API v2 (documents.json type=2 + 書類取得 type=5 CSV)",
      cache: "weekly",
      code,
      sec_code: fin.sec_code,
      window_days: days,
      financials_available: fin.financials_available,
      filer_name: fin.filer_name,
      doc_id: fin.doc_id,
      doc_type_code: fin.doc_type_code,
      doc_description: fin.doc_description,
      submit_datetime: fin.submit_datetime,
      period: fin.period,
      unit: fin.unit,
      sales: fin.sales,
      operating_income: fin.operating_income,
      net_income: fin.net_income,
      // Present while figure extraction is disabled: honest "metadata only" note.
      financials_note: fin.financials_note,
      // Present only when financials_available is false: the biggest current-年度
      // 連結 JPY rows, so the real element IDs are visible without ?debug.
      debug_unmatched: fin.debug_unmatched,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "edinet error";
    return NextResponse.json(
      { error: "edinet_unavailable", message, source: SOURCE_LABEL },
      { status: 502 },
    );
  }
}

export const GET = withSolanaUsdcMicroPaywall(handler, {
  units: PER_CALL_PRICE.base_units,
  // What the 402 challenge shows a buyer, so it states what actually comes
  // back. Figure extraction is paused (lib/edinet.ts FINANCIALS_ENABLED), and
  // this used to advertise "sales / operating income / net income" — a promise
  // the response has not kept since. Keep the two in step.
  description:
    "One company's latest EDINET disclosure: filer, document id / type / description, submission datetime and the accounting period (出典：金融庁 EDINET). Headline figures (sales / operating income / net income) are NOT served — they return null with financials_available:false. Settled per call in USDC on Solana (exact-svm).",
  resourcePath: "/api/edinet/:code",
});

export const OPTIONS = corsPreflight;
