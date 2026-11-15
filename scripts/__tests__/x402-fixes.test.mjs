/**
 * The x402 check of 2026-11-15, as tests:
 *   1  EDINET: a malformed code is 400 before any 402; no disclosure is 404 (not settled)
 *   2  a settled 2xx (201 included) is recorded with the URL paid for; a refetch is served
 *      only from that record for that same URL — no record, or another URL, is 404
 *   3  in production without Upstash nothing goes to /tmp and a refetch is 503
 *   4  a paid submission stays "pending" until settled; 10 minutes unpaid is not judged
 *   5  a paid 2xx carries Cache-Control: no-store, private
 *   6  the body is sent once /settle succeeds; the chain check runs after it, marks the record
 *      and logs when it fails, and a payer whose payment did not match is refused with 402
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
const { withReceipts, receiptStoreKind, solanaSignerAddresses, PAID_CACHE_CONTROL } = await import("../../lib/receipts.ts");
const { withX402AndInternal } = await import("../../lib/x402-route.ts");
const { buildSolanaOnlyRouteConfig, x402Server, SOLANA_NETWORK } = await import("../../lib/x402.ts");
const { readSettlement, verifySettlement } = await import("../../lib/solana-confirm.ts");
const { MemoryBlocklist } = await import("../../lib/payer-blocklist.ts");
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

const OK = { status: "ok", detail: "paid", payer: null, received: "1000" };

function setup({ storeKind = "upstash", chain = OK } = {}) {
  const seller = createReceiptSeller({ store: new MemoryStore() });
  const calls = { verify: 0, paywalled: 0 };
  const deferred = [];
  const logs = [];
  const blocklist = new MemoryBlocklist();
  const deps = {
    seller, storeKind, blocklist,
    verify: async () => { calls.verify += 1; return typeof chain === "function" ? chain() : chain; },
    defer: (work) => deferred.push(work),
    log: (l) => logs.push(l),
  };
  const route = (resource, paywalled, onDelivered) =>
    withReceipts(deps, { paywalled: async (r) => { calls.paywalled += 1; return paywalled(r); }, requirement: REQ, resource, onDelivered });
  /** Run what `after` would run once the response is sent. */
  const afterResponse = async () => { while (deferred.length) await deferred.shift()(); };
  return { seller, deps, route, calls, logs, blocklist, afterResponse };
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

// ── 6. chain check after delivery ─────────────────────────────────────────

test("6: the body is sent as soon as /settle succeeds — even when the RPC fails — and the record is marked and logged", async () => {
  const { seller, route, calls, logs, afterResponse } = setup({ chain: { status: "unverified", detail: "rpc unreachable: 429", payer: null, received: null } });
  const header = await paymentHeader();
  const res = await route(URL_A, settled(200, { secret: "data" }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(res.status, 200, "the buyer is never held up by our RPC");
  assert.deepEqual(await res.json(), { secret: "data" });
  assert.equal(calls.verify, 0, "nothing checked before the response");
  await afterResponse();
  assert.equal(calls.verify, 1);
  assert.match(logs.join("\n"), /\[x402 chain-check\] unverified tx=5VER.*rpc unreachable: 429/);
  const rec = await seller.store.get(TX);
  assert.equal(rec.chain_check.status, "unverified", "the record carries the mark");
  // An unverified payment is not refused: a refetch still delivers.
  const re = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(re.status, 200);
});

test("6: a payer whose payment did not match is refused with 402 next time, before verify and settle", async () => {
  const { route, calls, logs, blocklist, afterResponse } = setup({ chain: { status: "mismatch", detail: "payTo received 1 of USDC, expected 1000", payer: null, received: "1" } });
  const header = await paymentHeader();
  const first = await route(URL_A, settled(200, { a: 1 }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(first.status, 200);
  await afterResponse();
  assert.match(logs.join("\n"), /mismatch/);
  const [signer] = solanaSignerAddresses(header);
  assert.ok(signer, "the paying wallet is read from the signed transaction");
  assert.equal(await blocklist.has(signer), true);

  const before = calls.paywalled;
  const again = await route(URL_B, settled(200, { b: 2 }))(new Request(URL_B, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(again.status, 402);
  assert.equal((await again.json()).error, "payer_blocked");
  assert.equal(calls.paywalled, before, "refused before the paywall: no verify, no settle");

  const refetch = await route(URL_A, settled(200, {}))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
  assert.equal(refetch.status, 402, "a mismatched payment is not delivered again");

  const other = await route(URL_A, settled(200, { c: 3 }))(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": await paymentHeader() } }));
  assert.equal(other.status, 200, "other wallets are unaffected");
});

test("6: getTransaction is read as ok / failed / mismatch / unverified", async () => {
  const want = { payTo: REQ.payTo, asset: REQ.asset, amount: "1000" };
  const bal = (i, owner, amount, mint = REQ.asset) => ({ accountIndex: i, mint, owner, uiTokenAmount: { amount } });
  const tx = (o = {}) => ({
    meta: { err: null, preTokenBalances: [bal(1, "Buyer111", "5000"), bal(2, REQ.payTo, "0")], postTokenBalances: [bal(1, "Buyer111", "4000"), bal(2, REQ.payTo, "1000")], ...o },
    transaction: { message: { accountKeys: [] } },
  });
  const ok = readSettlement(tx(), want);
  assert.equal(ok.status, "ok");
  assert.equal(ok.payer, "Buyer111");
  assert.equal(readSettlement(tx({ err: { InstructionError: [0, "x"] } }), want).status, "failed");
  assert.equal(readSettlement(tx({ postTokenBalances: [bal(1, "Buyer111", "4999"), bal(2, REQ.payTo, "1")] }), want).status, "mismatch", "short amount");
  assert.equal(readSettlement(tx({ postTokenBalances: [bal(1, "Buyer111", "4000"), bal(2, "Someone", "1000")], preTokenBalances: [bal(1, "Buyer111", "5000"), bal(2, "Someone", "0")] }), want).status, "mismatch", "paid someone else");
  assert.equal(readSettlement(tx({ postTokenBalances: [bal(2, REQ.payTo, "1000", "OtherMint")], preTokenBalances: [bal(2, REQ.payTo, "0", "OtherMint")] }), want).status, "mismatch", "another asset");
  assert.equal(readSettlement(null, want).status, "unverified");

  let n = 0;
  const fetchImpl = async (_u, init) => {
    n += 1;
    assert.match(String(init.body), /getTransaction/);
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: n < 3 ? null : tx() }));
  };
  assert.equal((await verifySettlement(TX, want, { rpcUrl: "https://rpc.example", fetchImpl, intervalMs: 1 })).status, "ok");
  assert.equal(n, 3, "retried while the transaction is not visible yet");
  const down = async () => new Response("rate limited", { status: 429 });
  assert.equal((await verifySettlement(TX, want, { rpcUrl: "https://rpc.example", fetchImpl: down, attempts: 2, intervalMs: 1 })).status, "unverified");
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

test("4: onDelivered runs once settlement succeeded, not when the handler failed", async () => {
  let delivered = 0;
  const { route } = setup();
  const header = await paymentHeader();
  const failed = await route(URL_A, async () => Response.json({ error: "bad" }, { status: 400 }), async () => { delivered += 1; })(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(failed.status, 400);
  assert.equal(delivered, 0);
  const ok = await route(URL_A, settled(201, { catalyst_id: "ext_1", ticker: "7203" }), async () => { delivered += 1; })(new Request(URL_A, { headers: { "PAYMENT-SIGNATURE": header } }));
  assert.equal(ok.status, 201);
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
