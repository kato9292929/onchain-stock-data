import { NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard } from "@/lib/physical-ai-scoreboard";
import { corsPreflight, withPublicCors } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/alpha/catalysts/physical-ai — free, machine-readable track record
 * for the editorial "Physical AI" series dated catalysts. Mirrors the public
 * /catalysts page: overall hit-rate + per-article breakdown + every scorable
 * condition (main + sub) with its current verdict.
 *
 * FREE on purpose (public track record) so agents can poll it daily with no
 * x402 signature. To charge, swap `withPublicCors` for `withPaywall` (Base +
 * Solana) — the handler body is unchanged. The per-catalyst deep verdict stays
 * at the paid /api/alpha/catalyst/:id/score.
 */
const handler = async (): Promise<NextResponse> => {
  const all = await readExternalCatalysts();
  const asOf = new Date().toISOString().slice(0, 10);
  return NextResponse.json(buildScoreboard(all, asOf));
};

export const GET = withPublicCors(handler);

export const OPTIONS = () => corsPreflight();
