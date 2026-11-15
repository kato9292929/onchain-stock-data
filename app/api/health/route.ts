import { NextResponse } from "next/server";
import { corsPreflight } from "@/lib/x402-route";
import { receiptStoreKind } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — FREE. Deployment facts a buyer or the owner can check from
 * outside, no secrets: where delivery records are kept ("upstash" | "file", or
 * "none" in production without Upstash, where refetch then answers 503) and
 * whether settlements are checked on chain (after delivery) with a configured
 * RPC or the public one.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      receipts_store: receiptStoreKind(),
      settlement_check: process.env.SOLANA_RPC_URL ? "configured_rpc" : "public_rpc",
      environment: process.env.VERCEL_ENV ?? "local",
    },
    { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
  );
}

export const OPTIONS = corsPreflight;
