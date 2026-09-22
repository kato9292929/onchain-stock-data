/**
 * Who pays for /api/catalyst/{ticker}, decided before the paywall runs.
 *
 * Kept out of the route so the policy can be tested without importing the
 * x402 wrapper — importing that builds a paywall and starts a facilitator
 * handshake at module scope, which a unit test has no business triggering.
 */

export type CatalystAccess = "paid" | "free-draft" | "not-found";

interface HasTickerAndStage {
  ticker: string;
  stage?: string | null;
}

interface HasTicker {
  ticker: string;
}

/**
 * Decide how a ticker is served.
 *
 * - `paid` — a researched IR-Fair company (stage "active"), or a Physical-AI
 *   series catalyst. Both carry a dated condition worth charging for.
 * - `free-draft` — covered by the IR-Fair universe but not researched yet.
 *   Its row is empty apart from name/sector/market, which the free
 *   /api/catalyst index already publishes, so there is nothing to sell.
 * - `not-found` — in neither store.
 *
 * A draft row wins over a Physical-AI match only if it is genuinely a draft;
 * researched rows are checked first so a company in both stores stays paid.
 */
export function classifyCatalystAccess(
  ticker: string,
  irFairCatalysts: readonly HasTickerAndStage[],
  physicalAiCatalysts: readonly HasTicker[],
): CatalystAccess {
  const wanted = ticker.toUpperCase();
  const row = irFairCatalysts.find((c) => c.ticker.toUpperCase() === wanted);

  if (row?.stage === "active") return "paid";
  if (physicalAiCatalysts.some((c) => c.ticker.toUpperCase() === wanted)) {
    return "paid";
  }
  if (row) return "free-draft";
  return "not-found";
}
