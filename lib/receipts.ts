// Delivery Receipt (kato9292929/delivery-receipt, vendored in lib/delivery-receipt) for the
// paid mainnet routes: a settled 200 gets a signed X-Delivery-Receipt, and a request carrying
// X-Payment-Refetch is served from the stored body without verify/settle.
//
// RECEIPT_SIGNING_KEY is required: without it the server does not start (instrumentation.ts).
// Records go to the same Upstash Redis as the catalysts (UPSTASH_REDIS_REST_URL / _TOKEN,
// keys receipt:*, 8 days). Without Upstash, or with RECEIPT_STORE=file, they go to files
// (RECEIPT_STORE_DIR, default /tmp/osd-receipts — per instance on Vercel).
import type { RouteConfig } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import { FileStore, UpstashStore, createReceiptSeller, type PaymentRequirement, type ReceiptSeller } from "./delivery-receipt";
import { ASSET_SOLANA_USDC, SOLANA_NETWORK } from "./x402";

function store() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (process.env.RECEIPT_STORE !== "file" && url && token) return new UpstashStore({ url, token, keyPrefix: "receipt:" });
  return new FileStore(process.env.RECEIPT_STORE_DIR ?? "/tmp/osd-receipts");
}

let seller: ReceiptSeller | null = null;

/** Created on first use (throws when RECEIPT_SIGNING_KEY is not set). */
export function receiptSeller(): ReceiptSeller {
  seller ??= createReceiptSeller({ store: store() });
  return seller;
}

/** "$0.01" / 0.01 → "10000" (USDC, 6 decimals). */
export function moneyToAtomic(price: string | number): string {
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(String(price).trim());
  if (!m) throw new Error(`bad price: ${price}`);
  return String(BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0"));
}

/**
 * The single Solana-USDC requirement a route charges, or null when receipts do not apply
 * (several legs, another network or asset — e.g. the Base Sepolia testnet demo).
 */
export function solanaRequirement(rc: RouteConfig): PaymentRequirement | null {
  const raw = rc.accepts;
  const accepts: PaymentOption[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (accepts.length !== 1) return null;
  const a = accepts[0];
  if (a.network !== SOLANA_NETWORK || a.scheme !== "exact" || typeof a.payTo !== "string") return null;
  const p = a.price as unknown;
  if (typeof p === "object" && p !== null) {
    const { amount, asset } = p as { amount?: unknown; asset?: unknown };
    if (asset !== ASSET_SOLANA_USDC || typeof amount !== "string") return null;
    return { network: a.network, payTo: a.payTo, asset: ASSET_SOLANA_USDC, amount };
  }
  return { network: a.network, payTo: a.payTo, asset: ASSET_SOLANA_USDC, amount: moneyToAtomic(p as string | number) };
}
