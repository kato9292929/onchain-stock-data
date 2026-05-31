import { NextRequest, NextResponse } from "next/server";
import { runPerformanceUpdate } from "@/lib/jobs";
import { isCronAuthed } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Manual-trigger performance update (CRON_SECRET / INTERNAL_API_KEY auth).
 *
 * NOTE: the authoritative scheduled runner is GitHub Actions
 * (.github/workflows/update-performance.yml), which git-commits the data
 * files. On Vercel the FS is read-only so this route's write is best-effort.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPerformanceUpdate();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
