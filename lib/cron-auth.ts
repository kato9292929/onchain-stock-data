import { NextRequest } from "next/server";

/**
 * Cron auth. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also
 * accept the existing internal key (`X-Internal-Key: $INTERNAL_API_KEY`) so
 * the same routes can be triggered manually by our own backend.
 *
 * If neither CRON_SECRET nor INTERNAL_API_KEY is configured, the route is
 * left open (useful for local dev) but a warning is logged.
 */
export function isCronAuthed(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const internalKey = process.env.INTERNAL_API_KEY;

  if (!cronSecret && !internalKey) {
    console.warn(
      "[cron-auth] neither CRON_SECRET nor INTERNAL_API_KEY set — route is unauthenticated",
    );
    return true;
  }

  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  const provided = req.headers.get("x-internal-key");
  if (internalKey && provided && provided === internalKey) return true;

  return false;
}
