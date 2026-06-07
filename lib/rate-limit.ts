/**
 * Memory-based per-IP daily rate limiter (Phase A MVP).
 *
 * Keyed by `${ip}:${YYYY-MM-DD}` so the count naturally resets at UTC midnight;
 * stale keys are swept opportunistically. This lives in module state, so each
 * serverless instance counts independently — acceptable for Phase A abuse
 * prevention. A shared store (Vercel KV / Upstash) is the Phase A1 upgrade.
 */

interface Bucket {
  day: string;
  count: number;
}

const buckets = new Map<string, Bucket>();

export const DEFAULT_DAILY_LIMIT = 10;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Count after this request (whether allowed or not). */
  current: number;
}

/**
 * Record one hit for `ip` and report whether it is within `limit` for today.
 * A blocked request does NOT increment beyond the limit boundary repeatedly —
 * it is counted so `current` keeps climbing, which is fine for reporting.
 */
export function checkRateLimit(
  ip: string,
  limit: number = DEFAULT_DAILY_LIMIT,
): RateLimitResult {
  const day = todayIso();
  const key = `${ip}:${day}`;

  // Opportunistic sweep of yesterday's keys to bound memory.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.day !== day) buckets.delete(k);
    }
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.day !== day) {
    bucket = { day, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    current: bucket.count,
  };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Test-only: clear all buckets. */
export function _resetRateLimits(): void {
  buckets.clear();
}
