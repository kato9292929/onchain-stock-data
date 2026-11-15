/**
 * The x402 check of 2026-11-15, as tests:
 *   1  EDINET: a malformed code is 400 before any 402; no disclosure is 404 (not settled)
 *   2  a settled 2xx (201 included) is recorded with the URL paid for; a refetch is served
 *      only from that record for that same URL — no record, or another URL, is 404
 *   3  in production without Upstash nothing goes to /tmp and a refetch is 503
 *   4  a paid submission stays "pending" until settled; 10 minutes unpaid is not judged
 *   5  a paid 2xx carries Cache-Control: no-store, private
 *   6  the settlement transaction must be confirmed on chain before a body is sent
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, generateKeyPairSigner,
  getBase64EncodedWireTransaction, partiallySignTransaction, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

process.env.RECEIPT_SIGNING_KEY ??= randomBytes(32).toString("base64url"); // test-only, throwaway
process.env.INTERNAL_API_KEY = "test-internal-key";

const { NextRequest } = await import("next/server");
const { createReceiptSeller, MemoryStore } = await import("@x402jp/delivery-receipt-seller");
const { withReceipts, receiptStoreKind, PAID_CACHE_CONTROL } = await import("../../lib/receipts.ts");
const { withX402AndInternal } = await import("../../lib/x402-route.ts");
const { buildSolanaOnlyRouteConfig, x402Server, SOLANA_NETWORK } = await import("../../lib/x402.ts");
const { readSignatureStatus, signatureState } = await import("../../lib/solana-confirm.ts");
const { isUnpaidSubmission } = await import("../../lib/external-catalysts.ts");
const { isUnpaidSubmission: evaluateIsUnpaid } = await import("../evaluate-catalysts.mjs");

const TX = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const URL_A = "https://osd.x402jp.com/api/neocloud/CRWV?view=full";
const URL_B = "https://osd.x402jp.com/api/neocloud/IREN?view=full";
const REQ = { network: SOLANA_NETWORK, payTo: "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000" };

async function paymentHeader() {
  const payer = await generateKeyPairSigner();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer("11111111111111111111111111111111", m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction(
      { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [{ address: payer.address, role: 3 }], data: new Uint8Array([1]) }, m),
  );
  const tx = await partiallySignTransaction([payer.keyPair], compileTransaction(msg));
  const accept = { scheme: "exact", ...REQ };
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: accept, payload: { transaction: getBase64EncodedWireTransaction(tx) } })).toString("base64");
}

const settleHeader = (o = {}) => Buffer.from(JSON.stringify({ success: true, transaction: TX, network: SOLANA_NETWORK, ...o })).toString("base64");

/** A paywall that has already verified and settled: the handler's answer plus PAYMENT-RESPONSE. */
const settled = (status, body) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "PAYMENT-RESPONSE": settleHeader() } });

function setup({ storeKind = "upstash", chain = "confirmed" } = {}) {
  const seller = createReceiptSeller({ store: new MemoryStore() });
  const calls = { confirm: 0, paywalled: 0 };
  const deps = { seller, storeKind, confirm: async () => { calls.confirm += 1; return typeof chain === "function" ? chain() : chain; } };
  const route = (resource, paywalled, onDelivered) =>
    withReceipts(deps, { paywalled: async (r) => { calls.paywalled += 1; return paywalled(r); }, requirement: REQ, resource, onDelivered });
  return { seller, deps, route, calls };
}

// ── 2. records and refetch ────────────────────────────────────────────────

test("2: a settled 201 is recorded with the URL paid for, and sent with no-store and a receipt", async () => {
  const { seller, route } = setup();
  const header = await paymentHeader();
  const res = await route(URL_A, settled(201, { catalyst_id: "ext_1" }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("cache-control"), PAID_CACHE_CONTROL);
  assert.ok(res.headers.get("X-Delivery-Receipt"), "a 201 gets a receipt too");
  const rec = await seller.store.get(TX);
  assert.ok(rec, "recorded on 2xx, not only 200");
  assert.equal(rec.resource, URL_A);
});

test("2: a refetch for another URL is 404; without a record it is 404; the same URL gets the recorded body", async () => {
  const { route, calls } = setup();
  const header = await paymentHeader();
  await route(URL_A, settled(200, { company: "CRWV" }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  const before = calls.paywalled;

  const other = await route(URL_B, settled(200, {}))(new Request(URL_B, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(other.status, 404, "the same payment cannot be re-spent on another URL of the same price");

  const none = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": "1111NoSuchPayment" } }));
  assert.equal(none.status, 404, "no record: no rebuilding from the chain");

  const ok = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { company: "CRWV" });
  assert.equal(ok.headers.get("cache-control"), PAID_CACHE_CONTROL);
  assert.equal(calls.paywalled, before, "a refetch never reaches the paywall (no verify, no settle)");

  const stranger = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": await paymentHeader(), "X-Payment-Refetch": TX } }));
  assert.equal(stranger.status, 404, "another payer's header cannot refetch");
});

test("2: a 4xx from the handler is passed through and not recorded", async () => {
  const { seller, route } = setup();
  const res = await route(URL_A, async () => Response.json({ error: "no" }, { status: 404 }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": await paymentHeader() } }));
  assert.equal(res.status, 404);
  assert.equal(await seller.store.get(TX), null);
});

// ── 3. store ──────────────────────────────────────────────────────────────

test("3: production without Upstash keeps nothing in /tmp, and a refetch is 503", async () => {
  assert.equal(receiptStoreKind({ VERCEL_ENV: "production" }), "none");
  assert.equal(receiptStoreKind({ VERCEL_ENV: "production", RECEIPT_STORE: "file" }), "none", "no /tmp in production even when asked");
  assert.equal(receiptStoreKind({ VERCEL_ENV: "production", UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" }), "upstash");
  assert.equal(receiptStoreKind({ VERCEL_ENV: "preview" }), "file");
  assert.equal(receiptStoreKind({}), "file");

  const { seller, route } = setup({ storeKind: "none" });
  const header = await paymentHeader();
  const first = await route(URL_A, settled(200, { a: 1 }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(first.status, 200, "the buyer still gets what they paid for");
  assert.equal(await seller.store.get(TX), null, "nothing recorded");
  const re = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(re.status, 503);
});

// ── 6. on-chain confirmation ──────────────────────────────────────────────

test("6: not confirmed on chain → 503 and no body; the record is kept, so the refetch delivers once confirmed", async () => {
  let state = "pending";
  const { route } = setup({ chain: () => state });
  const header = await paymentHeader();
  const res = await route(URL_A, settled(200, { secret: "data" }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "payment_unconfirmed");
  assert.equal(body.secret, undefined, "no paid body before the chain confirms");
  assert.ok(res.headers.get("PAYMENT-RESPONSE"), "the buyer can still see the transaction");

  const early = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(early.status, 503);
  state = "confirmed";
  const later = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(later.status, 200);
  assert.deepEqual(await later.json(), { secret: "data" });
});

test("6: getSignatureStatuses is read as confirmed / pending / failed / unavailable", async () => {
  const v = (x) => ({ jsonrpc: "2.0", result: { value: [x] } });
  assert.equal(readSignatureStatus(v({ confirmationStatus: "finalized", err: null })), "confirmed");
  assert.equal(readSignatureStatus(v({ confirmationStatus: "confirmed", err: null })), "confirmed");
  assert.equal(readSignatureStatus(v({ confirmationStatus: "processed", err: null })), "pending");
  assert.equal(readSignatureStatus(v(null)), "pending");
  assert.equal(readSignatureStatus(v({ confirmationStatus: "finalized", err: { InstructionError: [0, "x"] } })), "failed");
  assert.equal(readSignatureStatus({ error: { code: -32005 } }), "unavailable");

  let n = 0;
  const fetchImpl = async (_u, init) => {
    n += 1;
    assert.match(String(init.body), /getSignatureStatuses/);
    return new Response(JSON.stringify(v(n < 3 ? null : { confirmationStatus: "confirmed", err: null })));
  };
  assert.equal(await signatureState(TX, { rpcUrl: "https://rpc.example", fetchImpl, intervalMs: 1 }), "confirmed");
  assert.equal(n, 3, "retried while not yet seen");
});

// ── 5. cache ──────────────────────────────────────────────────────────────

test("5: a paid 200 carries Cache-Control: no-store, private (internal-key path too)", async () => {
  const rc = buildSolanaOnlyRouteConfig("$0.001", "d", "/api/neocloud/:ticker");
  const route = withX402AndInternal(async () => Response.json({ ok: true }), rc, x402Server);
  const res = await route(new NextRequest(URL_A, { headers: { "x-internal-key": "test-internal-key" } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store, private");
});

// ── 4. submissions ────────────────────────────────────────────────────────

test("4: a submission still pending 10 minutes after it was written is not judged", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const at = (min) => new Date(now.getTime() - min * 60000).toISOString();
  for (const f of [isUnpaidSubmission, evaluateIsUnpaid]) {
    assert.equal(f({ payment_status: "pending", submitted_at: at(11) }, now), true);
    assert.equal(f({ payment_status: "pending", submitted_at: at(5) }, now), false, "still within its 10 minutes");
    assert.equal(f({ payment_status: "settled", submitted_at: at(60) }, now), false);
    assert.equal(f({ payment_status: "internal", submitted_at: at(60) }, now), false);
    assert.equal(f({ submitted_at: at(60) }, now), false, "editorial rows have no payment status");
  }
});

test("4: onDelivered runs only after the chain confirms", async () => {
  let delivered = 0;
  let state = "pending";
  const { route } = setup({ chain: () => state });
  const header = await paymentHeader();
  const r = () => route(URL_A, settled(201, { catalyst_id: "ext_1", ticker: "7203" }), async () => { delivered += 1; })(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal((await r()).status, 503);
  assert.equal(delivered, 0, "not marked settled while the chain has not confirmed");
  state = "confirmed";
  assert.equal((await r()).status, 201);
  assert.equal(delivered, 1);
});

// ── 1. EDINET ─────────────────────────────────────────────────────────────

test("1: EDINET — a malformed code is 400 before any 402; no disclosure in the window is 404", async () => {
  const { GET } = await import("../../app/api/edinet/[code]/route.ts");
  for (const code of ["ZZ!!", "ABC", "12345678"]) {
    const res = await GET(new NextRequest(`https://osd.x402jp.com/api/edinet/${encodeURIComponent(code)}`));
    assert.equal(res.status, 400, code);
    assert.equal((await res.json()).error, "bad_code");
  }
  // A well-formed code with nothing filed: the handler answers 404, which @x402/next never settles.
  const realFetch = globalThis.fetch;
  const keep = process.env.EDINET_API_KEY;
  process.env.EDINET_API_KEY = "test-key"; // test-only
  globalThis.fetch = async (u) =>
    String(u).includes("disclosure.edinet-fsa.go.jp") || String(u).includes("api.edinet-fsa.go.jp")
      ? new Response(JSON.stringify({ metadata: { status: "200" }, results: [] }), { headers: { "content-type": "application/json" } })
      : realFetch(u);
  try {
    const res = await GET(new NextRequest("https://osd.x402jp.com/api/edinet/9999?days=2", { headers: { "x-internal-key": "test-internal-key" } }));
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "no_disclosure");
  } finally {
    globalThis.fetch = realFetch;
    if (keep === undefined) delete process.env.EDINET_API_KEY;
    else process.env.EDINET_API_KEY = keep;
  }
});
