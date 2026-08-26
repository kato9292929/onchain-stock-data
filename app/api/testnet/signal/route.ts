import { NextRequest, NextResponse } from "next/server";
import { withTestnetPaywall, corsPreflight } from "@/lib/x402-route";
import { getSignals } from "@/lib/signals";

/**
 * TESTNET paid twin of the MCP `signal_get` tool — the "agent pays" demo.
 *
 * Unpaid → 402 (Base Sepolia USDC accept). An x402-capable client (AA) signs a
 * testnet USDC payment and retries → 200 with the pre-generated signals.
 *
 * COST: this reads data/signals.json only. There is NO Anthropic / LLM call on
 * this path — the signals are pre-generated and committed. Do not add live
 * generation here (see AGENTS.md cost-governance). Enforced by
 * scripts/__tests__/signal-no-llm.test.mjs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICE = process.env.X402_TESTNET_SIGNAL_PRICE ?? "$0.05";

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase() ?? null;
  const theme = url.searchParams.get("theme");

  const file = await getSignals().catch(() => null);
  const matched = (file?.signals ?? []).filter((s) => {
    if (ticker)
      return (
        s.scope?.toUpperCase() === ticker ||
        (s.tickers ?? []).some((t) => t.toUpperCase() === ticker)
      );
    if (theme) return s.scope === theme;
    return true;
  });

  return NextResponse.json({
    source: "onchain-stock-data / testnet signal demo",
    network: "eip155:84532",
    count: matched.length,
    signals: matched,
  });
}

export const GET = withTestnetPaywall(handler, {
  price: PRICE,
  description:
    "Pre-generated directional signals (testnet demo). Settled per-call in Base Sepolia USDC via x402.",
  resourcePath: "/api/testnet/signal",
});

export const OPTIONS = corsPreflight;
