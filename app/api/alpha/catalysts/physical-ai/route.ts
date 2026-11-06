import { NextResponse } from "next/server";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard } from "@/lib/physical-ai-scoreboard";
import { corsPreflight, withPublicCors } from "@/lib/x402-route";
import { catalystPublicId } from "@/lib/company-record";

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
  const board = buildScoreboard(all, asOf);
  const series = new Map(all.map((c) => [c.catalyst_id, c.series ?? null]));
  const pid = (id: string | null) => (id ? catalystPublicId(id, series.get(id) ?? "physical-ai") : null);
  return NextResponse.json({
    ...board,
    catalysts: board.catalysts.map(
      ({ catalyst_id, parent_catalyst_id, condition, status, evidence_urls, ...rest }) => ({
        id: pid(catalyst_id),
        parent_id: pid(parent_catalyst_id),
        ticker: rest.ticker,
        company: rest.company_name,
        question: condition,
        target_date: rest.target_date,
        result: status,
        judged_at: rest.judgement_date,
        evidence_url: evidence_urls[0] ?? null,
        evidence_urls,
        fail_direction: rest.fail_direction,
        reasoning: rest.reasoning,
        market: rest.market,
        country: rest.country,
        catalyst_type: rest.catalyst_type,
        date_confidence: rest.date_confidence,
        catalyst_role: rest.catalyst_role,
        series_article: rest.series_article,
      }),
    ),
  });
};

export const GET = withPublicCors(handler);

export const OPTIONS = () => corsPreflight();
