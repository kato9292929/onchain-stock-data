/**
 * Is this company still listed?
 *
 * Until now nothing in the *selection* path asked. The scorer found out the
 * hard way: 6967 新光電気工業 delisted on 2025-06-06, kept being picked, and
 * its catalyst came back `na` because a delisted company files no earnings to
 * judge against. It was selected again on 2026-10-12 — the check was missing,
 * not merely stale.
 *
 * The check is deliberately POSITIVE: "is this code in the current listing
 * master", not "is it on the delisted list". JPX's 上場廃止銘柄一覧 is a rolling
 * window — fetched 2026-10-14 it covered 2026/01/05 onward and did NOT contain
 * 6967 at all. Screening against it would have passed the one ticker that
 * caused the problem. The listing master (data_j.xlsx, ~4,450 rows) states
 * what IS listed, so anything absent is excluded whenever it went away.
 *
 * `data/jp-listed.json` is a committed snapshot refreshed by
 * `scripts/refresh-jp-listed.mjs`, so the weekly job needs no spreadsheet
 * parser and no network call that can fail mid-selection. It carries its own
 * `as_of`, and a snapshot that has gone stale is reported rather than trusted.
 */

export interface JpListedSnapshot {
  /** Date the JPX master was published, YYYY-MM-DD. */
  as_of: string;
  listed: Record<string, { name: string; segment: string; sector33?: string }>;
}

export interface HoldingLike {
  ticker: string;
  company_name?: string;
  weight?: number;
}

export interface ScreenResult<T> {
  kept: T[];
  dropped: Array<{ ticker: string; company_name?: string; reason: string }>;
}

/**
 * Drop holdings whose code is not in the listing master.
 *
 * Weights are renormalised across the survivors. Leaving them summing to 90
 * would publish a portfolio that does not add up, and the alternative — asking
 * the model for a replacement — is another billed call on a path that must not
 * block the weekly commit. The drop is logged either way, so the smaller book
 * is visible rather than silent.
 */
export function excludeDelisted<T extends HoldingLike>(
  holdings: readonly T[],
  snapshot: JpListedSnapshot,
): ScreenResult<T> {
  const kept: T[] = [];
  const dropped: ScreenResult<T>["dropped"] = [];

  for (const h of holdings) {
    const code = String(h.ticker ?? "").trim();
    if (code && snapshot.listed[code]) {
      kept.push(h);
    } else {
      dropped.push({
        ticker: code,
        company_name: h.company_name,
        reason: `not in the JPX listing master as of ${snapshot.as_of}`,
      });
    }
  }

  if (dropped.length === 0 || kept.length === 0) return { kept, dropped };

  const total = kept.reduce((n, h) => n + (h.weight ?? 0), 0);
  if (total > 0) {
    const scaled = kept.map((h) => ({
      ...h,
      weight: Math.round((((h.weight ?? 0) / total) * 100 + Number.EPSILON) * 10) / 10,
    }));
    // Rounding leaves a few tenths; put the remainder on the largest holding so
    // the published weights sum to exactly 100.
    const sum = scaled.reduce((n, h) => n + (h.weight ?? 0), 0);
    const drift = Math.round((100 - sum) * 10) / 10;
    if (drift !== 0) {
      let big = 0;
      for (let i = 1; i < scaled.length; i += 1) {
        if ((scaled[i].weight ?? 0) > (scaled[big].weight ?? 0)) big = i;
      }
      scaled[big] = {
        ...scaled[big],
        weight: Math.round(((scaled[big].weight ?? 0) + drift) * 10) / 10,
      };
    }
    return { kept: scaled, dropped };
  }

  return { kept, dropped };
}

/** Days between the snapshot and `today`; used to flag a stale screen. */
export function snapshotAgeDays(snapshot: JpListedSnapshot, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${snapshot.as_of}T00:00:00Z`)) /
      86_400_000,
  );
}
