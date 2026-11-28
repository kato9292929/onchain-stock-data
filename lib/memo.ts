/**
 * Keep an expensive result in this server instance's memory for `ttlMs`, so
 * the pages that recompute it on every request (the token list summary over
 * ~2,000 tickers, the Selection rows) pay for it once per window. Concurrent
 * callers share one in-flight computation; a failure is not kept.
 */
export function memoize<T>(fn: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let slot: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (!slot || Date.now() - slot.at > ttlMs) {
      const value = fn();
      const mine = { at: Date.now(), value };
      slot = mine;
      value.catch(() => {
        if (slot === mine) slot = null;
      });
    }
    return slot.value;
  };
}

export const FIVE_MINUTES = 5 * 60 * 1000;
