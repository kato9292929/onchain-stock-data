import { NextRequest, NextResponse } from "next/server";
import { withSolanaUsdcMicroPaywall, withPublicCors, corsPreflight } from "@/lib/x402-route";
import { PUBLIC_BASE_URL, THEME_CALL_PRICE } from "@/lib/x402";
import { loadRecords } from "@/lib/solana-stocks-load";
import { getSolanaStocks } from "@/lib/solana-stocks";
import { findTheme, getThemes, themeFreeBody, themeFullBody } from "@/lib/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/themes/{theme}            FREE — members: ticker, company, next
 *                                    earnings, next event date, Solana token
 * GET /api/themes/{theme}?view=full  PAID (x402 per-call, 0.01 USDC on Solana)
 *                                    — every member's catalysts (question,
 *                                    target date, structured conditions with
 *                                    the source document), latest verdict,
 *                                    Solana mints
 *
 * An unknown theme is 404 before any challenge. Static reads only.
 */

function themeOf(req: NextRequest): string {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(seg[seg.length - 1] ?? "").toLowerCase();
}

async function load() {
  const [themes, rec, solana] = await Promise.all([
    getThemes(),
    loadRecords(),
    getSolanaStocks().catch(() => null),
  ]);
  return { themes, rec, solana, today: new Date().toISOString().slice(0, 10) };
}

const paidGet = withSolanaUsdcMicroPaywall(
  async (req: NextRequest) => {
    const { themes, rec, solana, today } = await load();
    const theme = findTheme(themes, themeOf(req));
    return theme
      ? NextResponse.json(themeFullBody(theme, rec, solana, today))
      : NextResponse.json({ error: "theme not found" }, { status: 404 });
  },
  {
    units: THEME_CALL_PRICE.base_units,
    description:
      "One theme in one call (neocloud, physical AI, data centers · power and other sectors, weekly selections): every member's " +
      "catalysts with question, target date and structured conditions (metric / operator / threshold / source " +
      "document), the latest verdict with its evidence URL, next earnings from a primary source, and the Solana " +
      "token mints. Field reference: /docs.",
    resourcePath: "/api/themes/:theme?view=full",
  },
);

export const GET = async (req: NextRequest): Promise<NextResponse> => {
  if (req.method === "OPTIONS") return corsPreflight();
  const id = themeOf(req);
  const { themes, rec, solana, today } = await load();
  const theme = findTheme(themes, id);
  if (!theme) {
    return withPublicCors(async () => NextResponse.json({ error: "theme not found", theme: id }, { status: 404 }))(req);
  }
  if (new URL(req.url).searchParams.get("view") === "full") return paidGet(req);
  return withPublicCors(async () => NextResponse.json(themeFreeBody(theme, rec, solana, today, PUBLIC_BASE_URL)))(req);
};

export const OPTIONS = corsPreflight;
