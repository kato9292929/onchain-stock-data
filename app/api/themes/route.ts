import { NextResponse } from "next/server";
import { withPublicCors, corsPreflight } from "@/lib/x402-route";
import { loadRecords } from "@/lib/solana-stocks-load";
import { getThemes, themesIndexBody } from "@/lib/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/themes — FREE. Every theme: name, member count, members with an
 * event in the next 14 days, and when a catalyst was last added. Static reads
 * of committed files. Field reference: /docs.
 */
async function handler() {
  const [themes, rec] = await Promise.all([getThemes(), loadRecords()]);
  if (!themes) return NextResponse.json({ error: "themes unavailable" }, { status: 503 });
  return NextResponse.json(themesIndexBody(themes, rec, new Date().toISOString().slice(0, 10)));
}

export const GET = withPublicCors(handler);
export const OPTIONS = corsPreflight;
