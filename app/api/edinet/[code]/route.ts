import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, withPublicCors, corsPreflight } from "@/lib/x402-route";
import { PER_CALL_PRICE } from "@/lib/x402";
import {
  getLargeHoldings,
  dumpDocElements,
  LARGE_HOLDING_WINDOW_DAYS,
  SOURCE_LABEL,
  PROCESSED_BY,
} from "@/lib/edinet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cold cache: the first request of the week scans a window of daily lists +
// downloads one report's CSV. Give it room; warm requests return in ms.
export const maxDuration = 60;

/**
 * PAID (x402 per-call, 0.001 USDC, Solana mainnet exact-svm): one company's
 * 大量保有報告書 time series from EDINET — every 大量保有報告書 (350) and
 * 変更報告書 (360) filed on its shares in the window, newest first: who holds
 * (filer), which report, when, the document id and the PDF's API URL.
 *
 * Only EDINET list fields are served. The holding ratio and share count live in
 * each report's XBRL; they are NOT served until their element IDs are confirmed
 * on real reports (`?debug=elements` dumps the newest report's rows for that).
 * Values are never guessed.
 *
 * Terms compliance: every payload carries `source` = "出典：金融庁 EDINET" and
 * `processed_by`. Data is fetched only via the official EDINET API v2; date
 * lists are cached weekly.
 */
/** A TSE code (4 characters, e.g. 7203 / 593A) or the 5-character EDINET form (72030). */
const EDINET_CODE = /^[0-9][0-9A-Z]{3}[0-9]?$/;

function codeOf(req: NextRequest): string {
  // withX402 doesn't forward Next dynamic params — read the last path segment.
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").trim().toUpperCase();
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = codeOf(req);
  const days = Math.min(
    400,
    Math.max(1, Number(url.searchParams.get("days")) || LARGE_HOLDING_WINDOW_DAYS),
  );

  try {
    const lh = await getLargeHoldings(code, days);

    // Debug: the raw XBRL rows of the newest report, to confirm the holding-ratio
    // element IDs by fact. Unprocessed; same paywall.
    if (url.searchParams.get("debug") === "elements") {
      const newest = lh.filings[0];
      if (!newest) {
        return NextResponse.json({ error: "no_report", code, window_days: days, source: SOURCE_LABEL }, { status: 404 });
      }
      const dump = await dumpDocElements({
        doc_id: newest.doc_id,
        edinet_code: newest.holder_edinet_code,
        sec_code: null,
        filer_name: newest.holder_name,
        doc_description: newest.doc_description,
        doc_type_code: newest.doc_type_code,
        submit_datetime: newest.submit_datetime,
        period_start: null,
        period_end: null,
      });
      return NextResponse.json({ source: SOURCE_LABEL, pipeline: "edinet-large-holdings-v1", debug: true, code, ...dump });
    }

    // Nothing to deliver (unknown code, no own filing in the window, or no
    // large-holding report on it): 404, so the buyer is not charged. A 4xx from
    // the handler cancels settlement (@x402/next handleSettlement).
    if (!lh.issuer_edinet_code || lh.filings.length === 0) {
      return NextResponse.json(
        {
          error: lh.issuer_edinet_code ? "no_large_holding_reports" : "no_disclosure",
          message: lh.issuer_edinet_code
            ? "No 大量保有報告書 / 変更報告書 on this company in the window."
            : "No EDINET filing by this code in the window.",
          code,
          window_days: days,
          source: SOURCE_LABEL,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      source: SOURCE_LABEL,
      processed_by: PROCESSED_BY,
      pipeline: "edinet-large-holdings-v1",
      fetched_via: "EDINET API v2 (documents.json type=2)",
      cache: "weekly",
      code,
      sec_code: lh.sec_code,
      issuer_edinet_code: lh.issuer_edinet_code,
      issuer_name: lh.issuer_name,
      window_days: days,
      count: lh.filings.length,
      filings: lh.filings,
      holding_ratio_available: false,
      note: "Holding ratio and share count are not served yet: they are read from each report's XBRL only once the element IDs are confirmed on real reports.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "edinet error";
    return NextResponse.json(
      { error: "edinet_unavailable", message, source: SOURCE_LABEL },
      { status: 502 },
    );
  }
}

const paidGet = withSolanaUsdcMicroPaywall(handler, {
  units: PER_CALL_PRICE.base_units,
  // What the 402 challenge shows a buyer: keep it in step with the response.
  description:
    "One company's 大量保有報告書 time series from EDINET (出典：金融庁 EDINET): every 大量保有報告書 (350) and 変更報告書 (360) on its shares in the last 180 days — holder, report type, submission datetime, document id. Holding ratio is not served yet. Settled per call in USDC on Solana (exact-svm).",
  resourcePath: "/api/edinet/:code",
});

/** A malformed code is 400 before any challenge: nothing is verified or settled. */
export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  const code = codeOf(req);
  if (!EDINET_CODE.test(code)) {
    return withPublicCors(async () =>
      NextResponse.json(
        { error: "bad_code", message: "code must be a TSE code such as 7203 or 593A (or its 5-character EDINET form)", code },
        { status: 400 },
      ),
    )(req);
  }
  return paidGet(req);
};

export const OPTIONS = corsPreflight;
