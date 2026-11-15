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
//
// After a settled body is sent, the settlement transaction is checked on chain (status, USDC
// into payTo, exact amount). A failure is marked on the record and logged; a payer whose
// payment did not match is refused with 402 from then on (lib/payer-blocklist.ts).
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
import { after } from "next/server";
import { getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { solanaRpcUrl, verifySettlement, type SettlementResult } from "./solana-confirm";
import { payerBlocklist, type PayerBlocklist } from "./payer-blocklist";

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

/** What the after-delivery chain check found, kept on the delivery record. */
export interface ChainCheck {
  status: SettlementResult["status"];
  detail: string;
  checked_at: string;
}

export interface ReceiptDeps {
  seller: ReceiptSeller;
  storeKind: ReceiptStoreKind;
  /** Reads the settlement transaction on chain (lib/solana-confirm verifySettlement). */
  verify: (signature: string, requirement: PaymentRequirement) => Promise<SettlementResult>;
  /** Runs work after the response is sent (next/server `after`). */
  defer: (work: () => Promise<void>) => void;
  blocklist: PayerBlocklist;
  log?: (line: string) => void;
  now?: () => Date;
}

export const defaultReceiptDeps = (): ReceiptDeps => ({
  seller: receiptSeller(),
  storeKind: receiptStoreKind(),
  verify: (sig, r) => verifySettlement(sig, r, { rpcUrl: solanaRpcUrl(r.network) }),
  defer: (work) => after(work),
  blocklist: payerBlocklist(),
});

export interface WithReceiptsOptions {
  /** The x402 paywall (verify → handler → settle). */
  paywalled: (req: Request) => Promise<Response>;
  requirement: PaymentRequirement;
  /** The URL paid for: PUBLIC_BASE_URL + path + query of this request. */
  resource: string;
  /** Called once a settled 2xx is about to be sent. */
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

/** The wallets that signed a Solana payment (the buyer; the fee payer has not signed yet). */
export function solanaSignerAddresses(paymentHeader: string | null): string[] {
  const p = decodePaymentHeader(paymentHeader);
  // solanaPayerSignatures checks every signature against the message; none valid → none.
  if (!p || solanaPayerSignatures(p).length === 0) return [];
  try {
    const txB64 = (p.payload as { transaction?: string })?.transaction ?? "";
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(txB64));
    return Object.entries(tx.signatures)
      .filter(([, sig]) => sig && !sig.every((b) => b === 0))
      .map(([addr]) => addr);
  } catch {
    return [];
  }
}

async function markRecord(seller: ReceiptSeller, paymentId: string, check: ChainCheck) {
  const rec = await seller.store.get(paymentId);
  if (!rec) return;
  await seller.store.put({ ...rec, chain_check: check } as typeof rec, seller.retentionS);
}

/**
 * Delivery Receipts around a paywalled handler.
 *
 *   paid request    a payer refused earlier (blocklist) → 402, before verify / settle.
 *                   Otherwise verify → handler → settle (x402). A settled 2xx is recorded
 *                   with the URL paid for and sent at once, with a signed receipt and
 *                   Cache-Control: no-store, private. After it is sent, the settlement
 *                   transaction is checked on chain; anything but "ok" is marked on the
 *                   record and logged, and a mismatching payer is blocked.
 *   refetch         X-Payment-Refetch: the record of that payment, for this same URL, paid by
 *                   the signer of the re-sent payment header — else 404. A record whose chain
 *                   check failed or did not match is refused (402). No store: 503.
 */
export function withReceipts(deps: ReceiptDeps, opts: WithReceiptsOptions) {
  const { seller, storeKind } = deps;
  const network = normalizeNetwork(opts.requirement.network);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((l: string) => console.error(l));

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
      const check = (record as { chain_check?: ChainCheck }).chain_check;
      if (check && (check.status === "failed" || check.status === "mismatch")) {
        return json(402, { error: "payment_rejected", detail: check.detail });
      }
      if (now().getTime() - Date.parse(record.issued_at) > seller.refetchWindowS * 1000) {
        return json(410, { error: "refetch_expired" });
      }
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

    // A payer whose earlier payment did not match is refused before verify / settle.
    if (paymentHeader) {
      for (const a of solanaSignerAddresses(paymentHeader)) {
        let blocked = false;
        try {
          blocked = await deps.blocklist.has(a);
        } catch {
          blocked = false;
        }
        if (blocked) {
          return json(402, {
            error: "payer_blocked",
            message: "An earlier payment from this wallet did not match the payment requirements; payments from it are not accepted.",
          });
        }
      }
    }

    const res = await opts.paywalled(req);
    if (!is2xx(res.status)) return res;
    const settle = decodeSettleResponse(pick(res, PAYMENT_RESPONSE_HEADERS));
    if (!settle || settle.success !== true) return res;

    const body = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    const contentType = headers.get("content-type") ?? "application/octet-stream";

    // Recorded before it is sent, with the URL paid for.
    let receiptHeader: string | null = null;
    let paymentId: string | null = null;
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
      paymentId = prepared?.record.payment_id ?? null;
    }
    if (opts.onDelivered) await opts.onDelivered(body, contentType);

    // After the body is sent: is the payment really on chain, to us, in full?
    const tx = typeof settle.transaction === "string" ? settle.transaction : "";
    const settledPayer = typeof settle.payer === "string" ? settle.payer : null;
    deps.defer(async () => {
      const r: SettlementResult = tx
        ? await deps.verify(tx, opts.requirement).catch((e) => ({ status: "unverified" as const, detail: String(e), payer: null, received: null }))
        : { status: "unverified", detail: "no transaction in PAYMENT-RESPONSE", payer: null, received: null };
      if (r.status === "ok") return;
      const check: ChainCheck = { status: r.status, detail: r.detail, checked_at: now().toISOString() };
      log(`[x402 chain-check] ${r.status} tx=${tx || "-"} resource=${opts.resource} payer=${r.payer ?? settledPayer ?? "-"}: ${r.detail}`);
      if (paymentId) await markRecord(seller, paymentId, check).catch((e) => log(`[x402 chain-check] could not mark record: ${e}`));
      if (r.status === "mismatch") {
        const who = [...new Set([r.payer, settledPayer, ...solanaSignerAddresses(paymentHeader)].filter((x): x is string => Boolean(x)))];
        for (const a of who) await deps.blocklist.add(a, `${r.detail} (tx ${tx})`).catch((e) => log(`[x402 chain-check] could not block ${a}: ${e}`));
      }
    });

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
