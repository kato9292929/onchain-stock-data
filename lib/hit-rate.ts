import type { EvaluationStatus } from "./data";

/**
 * The one hit-rate formula for every scoreboard on this site.
 *
 * Before this module there were two. The Physical-AI and IR-Fair boards scored
 * `(hit + partial×0.5) / (hit + partial + miss)`, while the JP portfolio page
 * scored `hit / (hit + partial + miss + na)` — so a `partial` was worth half a
 * hit on one page and nothing on another, and the same track record read 65%
 * or 38% depending on which page you landed on.
 *
 * Two decisions are baked in here, and both are deliberate:
 *
 * 1. **A `partial` counts as half a hit.** A condition that was half right is
 *    not a miss, and collapsing it to one is what made the JP number look
 *    worse than the record deserved.
 *
 * 2. **`na` stays in the denominator.** This is the one that matters. `na`
 *    means "we could not judge this", and when the 21 JP `na` rows were read
 *    one by one, 20 of them were our own doing: 13 conditions asked for a
 *    figure the company never discloses at that granularity, 7 were scored by
 *    an evaluator that mistook the pick week for today, and 1 was written for
 *    a company that had already delisted. Exactly one was outside our control.
 *    Dropping `na` from the denominator would quietly delete our own
 *    condition-writing mistakes from our published score — it would take the
 *    JP number from 48% to 65% on nothing but bookkeeping. A condition we
 *    could not write well enough to judge did not earn a hit.
 *
 * Physical AI has no `na` rows at all, so this change leaves its number exactly
 * where it was. The only board that moves is the one whose `na` pile is real.
 */

export type ScoreCounts = Record<
  "hit" | "partial" | "miss" | "na" | "pending",
  number
>;

/** Everything with a verdict. `pending` has no verdict yet and never counts. */
export const JUDGED: EvaluationStatus[] = ["hit", "partial", "miss", "na"];

export function emptyCounts(): ScoreCounts {
  return { hit: 0, partial: 0, miss: 0, na: 0, pending: 0 };
}

export function tally(statuses: Iterable<EvaluationStatus>): ScoreCounts {
  const counts = emptyCounts();
  for (const s of statuses) counts[s] += 1;
  return counts;
}

/** hit + partial + miss + na — the denominator, and the "judged N" the UI shows. */
export function judgedCount(c: ScoreCounts): number {
  return c.hit + c.partial + c.miss + c.na;
}

/**
 * (hit + partial×0.5) / (hit + partial + miss + na), or null when nothing has
 * been judged yet. Returns a 0–1 fraction; formatting is the caller's business.
 */
export function hitRateOf(c: ScoreCounts): number | null {
  const judged = judgedCount(c);
  return judged > 0 ? (c.hit + c.partial * 0.5) / judged : null;
}
