import {
  conditionsFor,
  financialsOf,
  latestVerdict,
  nextEarningsOf,
  resultCounts,
  signalsFor,
  type Records,
} from "@/lib/company-record";
import { classifyCatalystAccess, type CatalystAccess } from "@/lib/catalyst-access";
import { themesFor } from "@/lib/themes";

/**
 * Response bodies for /api/catalyst/{ticker}, kept out of the route so they can
 * be tested without importing the x402 wrapper. Data only — field meanings are
 * in /docs.
 */

const JP_CODE = /^\d{3}[0-9A-Z]$/;

export function catalystAccess(ticker: string, rec: Records): CatalystAccess {
  return classifyCatalystAccess(ticker, rec.irFair?.catalysts ?? [], rec.externals, [
    ...(rec.usEvals?.evaluations ?? []),
    ...(rec.jpEvals?.evaluations ?? []),
  ]);
}

function identity(ticker: string, rec: Records) {
  const want = ticker.toUpperCase();
  const ir = (rec.irFair?.catalysts ?? []).find((c) => c.ticker.toUpperCase() === want);
  const rows = conditionsFor(want, rec);
  const fin = financialsOf(want, rec);
  return {
    want,
    ir,
    rows,
    fin,
    head: {
      ticker: want,
      name: ir?.company_name ?? rows.find((r) => r.company)?.company ?? fin?.company ?? null,
      market: ir?.market ?? (JP_CODE.test(want) ? "JP" : "US"),
      ...(ir ? { tse_market: ir.tse_market ?? null, sector: ir.sector, stage: ir.stage } : {}),
      themes: themesFor(want, rec.themes, rec),
    },
  };
}

/** Free view: who, next earnings, how many conditions, the latest verdict. */
export function catalystFreeBody(ticker: string, rec: Records, today: string, baseUrl: string) {
  const { want, rows, head } = identity(ticker, rec);
  const access = catalystAccess(want, rec);
  if (access === "not-found") return null;
  return {
    ...head,
    researched: access === "paid",
    next_earnings: nextEarningsOf(want, rec, today),
    condition_count: rows.length,
    result_counts: resultCounts(rows),
    latest_verdict: latestVerdict(rows),
    full:
      access === "paid"
        ? {
            url: `${baseUrl}/api/catalyst/${encodeURIComponent(want)}`,
            price_usdc: "0.001",
            network: "solana",
            scheme: "exact",
          }
        : null,
  };
}

/** Paid view: every condition in full, disclosed financials, signals. */
export function catalystFullBody(ticker: string, rec: Records, today: string) {
  const { want, rows, fin, head } = identity(ticker, rec);
  if (catalystAccess(want, rec) === "not-found") return null;
  return {
    ...head,
    next_earnings: nextEarningsOf(want, rec, today),
    financials: fin,
    conditions: rows,
    signals: signalsFor(want, rec),
  };
}
