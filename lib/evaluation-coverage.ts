/**
 * Does every week we selected actually reach the scorer?
 *
 * Two pipelines run side by side. `update-portfolio` / `update-jp-portfolio`
 * pick ten names a week and commit them with a condition and a target date;
 * `evaluate-catalysts` later judges whichever rows exist in the evaluations
 * file. Nothing structural connects the two — the scorer has to go and read
 * the selection history and register rows for itself.
 *
 * JP did that. US did not: its rows came from a one-shot backfill, and once
 * those were judged on 2026-07-08 the scorer had nothing left to look at.
 * Selection kept running perfectly every week for three months while the US
 * scorecard sat frozen.
 *
 * What made it survive that long is the shape of the failure. A missing link
 * does not throw, and it does not leave a half-written row — it leaves NO row,
 * so the scorecard reported `pending: 0`, which reads exactly like "everything
 * is judged and nothing is waiting". The absence of work looked like the
 * absence of a backlog. Tests stayed green the whole time, because every test
 * there was asked whether the rows that exist behave correctly.
 *
 * So this module asks the one question none of them did: for each week we
 * selected, is there a row to judge? It is deliberately about ABSENCE.
 */

/**
 * US holdings are auto-registered as pending evaluations only from this week on.
 *
 * The 90 holdings selected between 2026-06-29 and 2026-09-14 are **permanently
 * out of scope**, by decision rather than by accident: judging them would buy
 * back three months of history that nobody is waiting on, at a cost nobody has
 * measured, while the thing that actually mattered — noticing the next time a
 * link breaks — costs nothing. The 49 holdings before 2026-06-15 carry no
 * `target_date` at all and were never judgeable.
 *
 * So the US track record is defined as "from 2026-09-21, under the current
 * design". Moving this back is a paid decision: measure one run first.
 *
 * `scripts/evaluate-catalysts.mjs` carries a second copy, because that script
 * runs under plain `node` and cannot import a `.ts` module — doing so breaks
 * the weekly cron. A copied constant is the exact shape of bug this module
 * exists to catch, so the two are pinned to each other by a test rather than
 * left to drift.
 */
export const US_AUTOREGISTER_FROM =
  process.env.US_AUTOREGISTER_FROM ?? "2026-09-21";

interface Holding {
  ticker?: string | null;
  target_date?: string | null;
}

interface PortfolioWeek {
  week_of?: string | null;
  holdings?: Holding[] | null;
}

export interface PortfolioHistory {
  current?: PortfolioWeek | null;
  history?: PortfolioWeek[] | null;
}

interface EvaluationRow {
  week_of?: string | null;
  ticker?: string | null;
}

export interface WeekCoverage {
  week_of: string;
  /** Holdings carrying a `target_date` — the only ones that can be judged. */
  holdings: number;
  /** Of those, how many have no row in the evaluations file. */
  unregistered: number;
}

export interface Coverage {
  /** Weeks old enough to check, at or after the cutoff. */
  weeks: WeekCoverage[];
  /** The subset with at least one unregistered holding — a broken link. */
  gaps: WeekCoverage[];
  unregistered: number;
}

export interface CoverageOptions {
  /**
   * Weeks before this are not expected to be registered. For US this is
   * `US_AUTOREGISTER_FROM` — the 90 holdings from 2026-06-29 to 2026-09-14
   * were deliberately written off rather than paid for, so counting them as
   * gaps forever would just train everyone to ignore the alarm. JP passes
   * nothing: it has always self-registered, so every week is fair game.
   */
  cutoff?: string | null;
  /** Today, as YYYY-MM-DD. */
  asOf: string;
  /**
   * How long a week is given before its absence counts as a gap. Selection
   * commits at 21:00 UTC Sunday and the scorer runs at 22:00 the same night,
   * so the newest week is legitimately unregistered for an hour — and for a
   * whole week if one scorer run is missed. Eight days clears both without
   * hiding a link that is actually severed.
   */
  graceDays?: number;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** Every (week, ticker) that was selected with a judgeable target date. */
function selectedByWeek(history: PortfolioHistory): Map<string, Set<string>> {
  const weeks = new Map<string, Set<string>>();
  const all = [
    ...(history.current ? [history.current] : []),
    ...(Array.isArray(history.history) ? history.history : []),
  ];
  for (const week of all) {
    const key = week?.week_of;
    if (!key || !Array.isArray(week.holdings)) continue;
    for (const holding of week.holdings) {
      const ticker = String(holding?.ticker ?? "").toUpperCase();
      // No target date, nothing to judge it against. The four US weeks before
      // 2026-06-15 are all like this and are out of scope permanently.
      if (!ticker || !holding?.target_date) continue;
      if (!weeks.has(key)) weeks.set(key, new Set());
      weeks.get(key)!.add(ticker);
    }
  }
  return weeks;
}

export function evaluationCoverage(
  history: PortfolioHistory,
  evaluations: readonly EvaluationRow[],
  { cutoff = null, asOf, graceDays = 8 }: CoverageOptions,
): Coverage {
  const registered = new Set(
    evaluations.map(
      (e) => `${e.week_of}::${String(e.ticker ?? "").toUpperCase()}`,
    ),
  );

  const weeks: WeekCoverage[] = [];
  for (const [week_of, tickers] of [...selectedByWeek(history)].sort()) {
    if (cutoff && week_of < cutoff) continue;
    if (daysBetween(week_of, asOf) < graceDays) continue;
    const unregistered = [...tickers].filter(
      (t) => !registered.has(`${week_of}::${t}`),
    ).length;
    weeks.push({ week_of, holdings: tickers.size, unregistered });
  }

  return {
    weeks,
    gaps: weeks.filter((w) => w.unregistered > 0),
    unregistered: weeks.reduce((n, w) => n + w.unregistered, 0),
  };
}
