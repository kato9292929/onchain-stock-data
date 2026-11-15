// Delivery Receipt (npm @x402jp/delivery-receipt-seller, kato9292929/delivery-receipt) for the
// paid mainnet routes: a settled 2xx gets a signed X-Delivery-Receipt and is recorded with the
// URL it was paid for; a request carrying X-Payment-Refetch is served from that record only.
//
// RECEIPT_SIGNING_KEY is required: without it the server does not start (instrumentation.ts).
// Records go to the same Upstash Redis as the catalysts (UPSTASH_REDIS_REST_URL / _TOKEN,
// keys receipt:*, 8 days). Outside production, without Upstash (or with RECEIPT_STORE=file),
// they go to files (RECEIPT_STORE_DIR, default /tmp/osd-receipts). In production
// (VERCEL_ENV=production) /tmp is never used: without Upstash nothing is recorded, an error is
// logged at start, and refetch answers 503.
//
// The x402 2026-11-15 check: a refetch used to fall back to "is there a payment of this amount
// on chain?" when no record existed, which let one payment be re-spent on any other URL of the
// same price. That path is gone: no record, or a record for another URL, is 404.
import type { RouteConfig } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import {
  FileStore,
  MemoryStore,
  REFETCH_HEADER,
  RECEIPT_HEADER,
  EXPOSE_HEADERS,
  PAYMENT_HEADERS,
  PAYMENT_RESPONSE_HEADERS,
  UpstashStore,
  createReceiptSeller,
  decodePaymentHeader,
  decodeSettleResponse,
  isSolanaNetwork,
  normalizeNetwork,
  solanaPayerSignatures,
  type PaymentRequirement,
  type ReceiptSeller,
  type ReceiptStore,
} from "@x402jp/delivery-receipt-seller";
import { ASSET_SOLANA_USDC, SOLANA_NETWORK } from "./x402";
import { signatureState, solanaRpcUrl, type SignatureState } from "./solana-confirm";

export type ReceiptStoreKind = "upstash" | "file" | "none";

/** Where receipts are kept, from the environment. Production never uses /tmp. Pure. */
export function receiptStoreKind(env: NodeJS.ProcessEnv = process.env): ReceiptStoreKind {
  if (env.RECEIPT_STORE !== "file" && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  if (env.VERCEL_ENV === "production") return "none";
  return "file";
}

function storeFor(kind: ReceiptStoreKind): ReceiptStore {
  if (kind === "upstash") {
    return new UpstashStore({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      keyPrefix: "receipt:",
    });
  }
  if (kind === "file") return new FileStore(process.env.RECEIPT_STORE_DIR ?? "/tmp/osd-receipts");
  // "none": the seller still needs a store to exist; it is never written or read.
  return new MemoryStore();
}

let seller: ReceiptSeller | null = null;

/** Created on first use (throws when RECEIPT_SIGNING_KEY is not set). */
export function receiptSeller(): ReceiptSeller {
  if (!seller) {
    const kind = receiptStoreKind();
    if (kind === "none") {
      console.error(
        "[receipts] production without UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN: delivery records are " +
          "not kept (no /tmp in production) and X-Payment-Refetch answers 503. Add the Upstash variables in Vercel.",
      );
    }
    seller = createReceiptSeller({ store: storeFor(kind) });
  }
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

// ── delivery ──────────────────────────────────────────────────────────────

export const PAID_CACHE_CONTROL = "no-store, private";

export interface ReceiptDeps {
  seller: ReceiptSeller;
  storeKind: ReceiptStoreKind;
  /** On-chain state of a settled transaction (lib/solana-confirm). */
  confirm: (signature: string, network: string) => Promise<SignatureState>;
  now?: () => Date;
}

export const defaultReceiptDeps = (): ReceiptDeps => ({
  seller: receiptSeller(),
  storeKind: receiptStoreKind(),
  confirm: (sig, network) => signatureState(sig, { rpcUrl: solanaRpcUrl(network) }),
});

export interface WithReceiptsOptions {
  /** The x402 paywall (verify → handler → settle). */
  paywalled: (req: Request) => Promise<Response>;
  requirement: PaymentRequirement;
  /** The URL paid for: PUBLIC_BASE_URL + path + query of this request. */
  resource: string;
  /** Called once a settled 2xx is confirmed on chain, before the body is sent. */
  onDelivered?: (body: Uint8Array, contentType: string) => Promise<void>;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": PAID_CACHE_CONTROL,
      "access-control-expose-headers": EXPOSE_HEADERS,
      ...extra,
    },
  });

const pick = (req: { headers: Headers }, names: readonly string[]) => {
  for (const n of names) {
    const v = req.headers.get(n);
    if (v) return v;
  }
  return null;
};

const is2xx = (s: number) => s >= 200 && s < 300;

function unconfirmed(paymentId: string, state: SignatureState, headers: Headers) {
  const out = json(
    503,
    {
      error: "payment_unconfirmed",
      message:
        state === "failed"
          ? "The settlement transaction failed on chain; nothing is delivered."
          : "The settlement is not yet confirmed on chain. Retry with the same payment header and " +
            `${REFETCH_HEADER}: <payment_id>; nothing is charged again.`,
      payment_id: paymentId,
      chain_state: state,
      refetch_header: REFETCH_HEADER,
    },
    { "retry-after": "10" },
  );
  for (const h of PAYMENT_RESPONSE_HEADERS) {
    const v = headers.get(h);
    if (v) out.headers.set(h, v);
  }
  return out;
}

/**
 * Delivery Receipts around a paywalled handler.
 *
 *   paid request    verify → handler → settle (x402). A settled 2xx is checked on chain
 *                   (confirmed or finalized), recorded with the URL paid for, and only then
 *                   sent, with a signed receipt and Cache-Control: no-store, private. Not
 *                   confirmed: 503 payment_unconfirmed (the record is kept, so a refetch
 *                   delivers once the chain confirms).
 *   refetch         X-Payment-Refetch: the record of that payment, for this same URL, paid by
 *                   the signer of the re-sent payment header — else 404. No store: 503.
 */
export function withReceipts(deps: ReceiptDeps, opts: WithReceiptsOptions) {
  const { seller, storeKind } = deps;
  const network = normalizeNetwork(opts.requirement.network);
  const now = deps.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    const paymentHeader = pick(req, PAYMENT_HEADERS);
    const refetchId = req.headers.get(REFETCH_HEADER);

    if (refetchId !== null) {
      if (storeKind === "none") return json(503, { error: "refetch_unavailable", message: "Delivery records are not kept on this deployment." });
      const id = refetchId.trim();
      if (!id) return json(400, { error: "refetch_bad_request", detail: `empty ${REFETCH_HEADER}` });
      let record;
      try {
        record = (await seller.store.get(id)) ?? (await seller.store.get(id.toLowerCase()));
      } catch {
        return json(503, { error: "refetch_unavailable" });
      }
      if (!record || record.resource !== opts.resource || normalizeNetwork(record.network) !== network) {
        return json(404, { error: "refetch_not_found", detail: "no delivery of this payment for this URL" });
      }
      const p = decodePaymentHeader(paymentHeader);
      const signers = p && isSolanaNetwork(network) ? solanaPayerSignatures(p) : [];
      if (!signers.includes(record.payer)) {
        return json(404, { error: "refetch_not_found", detail: "the payment header does not belong to this delivery" });
      }
      if (now().getTime() - Date.parse(record.issued_at) > seller.refetchWindowS * 1000) {
        return json(410, { error: "refetch_expired" });
      }
      const state = await deps.confirm(record.payment_id, network);
      if (state !== "confirmed") return unconfirmed(record.payment_id, state, new Headers());
      const body = new Uint8Array(Buffer.from(record.body, "base64"));
      const { header } = seller.issueReceipt({ payment_id: record.payment_id, network, resource: opts.resource, body, delivery: "refetch" });
      return new Response(Buffer.from(body), {
        status: 200,
        headers: {
          "content-type": record.content_type,
          "cache-control": PAID_CACHE_CONTROL,
          [RECEIPT_HEADER.toLowerCase()]: header,
          "access-control-expose-headers": EXPOSE_HEADERS,
        },
      });
    }

    const res = await opts.paywalled(req);
    if (!is2xx(res.status)) return res;
    const settle = decodeSettleResponse(pick(res, PAYMENT_RESPONSE_HEADERS));
    if (!settle || settle.success !== true) return res;

    const body = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    const contentType = headers.get("content-type") ?? "application/octet-stream";

    // Record first (so a refetch can deliver even when the chain is slow), with the URL paid for.
    let receiptHeader: string | null = null;
    if (storeKind !== "none") {
      const prepared = await seller.recordFirstDelivery({
        requirement: opts.requirement,
        resource: opts.resource,
        paymentHeader,
        settle,
        body,
        contentType,
      });
      receiptHeader = prepared?.header ?? null;
    }

    const tx = typeof settle.transaction === "string" ? settle.transaction : "";
    const state = tx ? await deps.confirm(tx, network) : "unavailable";
    if (state !== "confirmed") return unconfirmed(tx, state, headers);

    if (opts.onDelivered) await opts.onDelivered(body, contentType);
    if (receiptHeader) headers.set(RECEIPT_HEADER, receiptHeader);
    headers.set("cache-control", PAID_CACHE_CONTROL);
    const expose = new Set(
      `${headers.get("access-control-expose-headers") ?? ""}, ${EXPOSE_HEADERS}`.split(",").map((s) => s.trim()).filter(Boolean),
    );
    headers.set("access-control-expose-headers", [...expose].join(", "));
    headers.delete("content-length");
    return new Response(body.byteLength ? Buffer.from(body) : null, { status: res.status, statusText: res.statusText, headers });
  };
}
