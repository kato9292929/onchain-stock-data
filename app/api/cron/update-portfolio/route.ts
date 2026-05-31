import { NextRequest, NextResponse } from "next/server";
import { runPortfolioUpdate } from "@/lib/jobs";
import { isCronAuthed } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Manual-trigger portfolio update (CRON_SECRET / INTERNAL_API_KEY auth).
 *
 * NOTE: the authoritative scheduled runner is GitHub Actions
 * (.github/workflows/update-portfolio.yml), which git-commits the data files.
 * This route stays for ad-hoc manual triggers, but on Vercel the FS is
 * read-only so its write is best-effort (the computed portfolio is returned
 * regardless). The two Vercel crons were removed from vercel.json.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPortfolioUpdate({ horizon: "1m" });
  if (!result.ok) {
    return NextResponse.json(
      { error: "selection_failed", message: result.error },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
