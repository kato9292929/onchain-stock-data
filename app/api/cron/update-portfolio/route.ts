import { NextRequest, NextResponse } from "next/server";
import { getPortfolioHistory } from "@/lib/data";
import {
  selectPortfolio,
  appendPortfolio,
  writePortfolioHistory,
} from "@/lib/portfolio";
import { isCronAuthed } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly cron (Mon 06:00 JST). Has Claude select the portfolio, rotates the
 * previous current into history, and persists to data/portfolio-history.json.
 * Calls lib/* directly (no HTTP self-call, no circular /api/predict hit).
 *
 * On Vercel the data file write is best-effort (read-only FS); the computed
 * portfolio is always returned so a GitHub Action can commit it for the
 * git-tracked history.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const weekOf = mondayOf(new Date());
  const selected = await selectPortfolio({ weekOf, horizon: "1m" });
  if (!selected.ok) {
    return NextResponse.json(
      { error: "selection_failed", message: selected.error },
      { status: 502 },
    );
  }

  let prev;
  try {
    prev = await getPortfolioHistory();
  } catch {
    prev = {
      source: "claude-portfolio",
      note: "",
      updated_at: new Date().toISOString(),
      current: null,
      history: [],
    };
  }

  const next = appendPortfolio(prev, selected.portfolio);
  const write = await writePortfolioHistory(next);

  return NextResponse.json({
    ok: true,
    week_of: weekOf,
    persisted: write.persisted,
    persist_reason: write.reason,
    portfolio: selected.portfolio,
  });
}

export const GET = handle;
export const POST = handle;

/** ISO date (YYYY-MM-DD) of the Monday on or before `d` (UTC). */
function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}
