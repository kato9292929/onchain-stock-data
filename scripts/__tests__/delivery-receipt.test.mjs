/**
 * Delivery Receipt on the paid mainnet routes (lib/receipts.ts, lib/x402-route.ts).
 *
 * A refetch (original payment header + X-Payment-Refetch) is served from the stored
 * delivery without reaching withX402 — no verify, no settle — and its receipt verifies.
 * The first delivery is recorded here directly (as the route does right after settle),
 * with a payment tx signed on the spot by a throwaway key and never sent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, generateKeyPairSigner,
  getBase64EncodedWireTransaction, partiallySignTransaction, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

process.env.RECEIPT_SIGNING_KEY = randomBytes(32).toString("base64url"); // test-only, throwaway
process.env.RECEIPT_STORE = "file";
process.env.RECEIPT_STORE_DIR = mkdtempSync(join(tmpdir(), "osd-receipts-"));

const { NextRequest } = await import("next/server");
const { withX402AndInternal } = await import("../../lib/x402-route.ts");
const { buildSolanaOnlyRouteConfig, solanaUsdcUnits, x402Server, SOLANA_NETWORK } = await import("../../lib/x402.ts");
const { moneyToAtomic, receiptSeller, solanaRequirement } = await import("../../lib/receipts.ts");
const { verifyReceipt } = await import("../../lib/delivery-receipt/verify.ts");

const TX = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

async function paymentHeader(rc) {
  const payer = await generateKeyPairSigner();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer("11111111111111111111111111111111", m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction(
      { programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", accounts: [{ address: payer.address, role: 3 }], data: new Uint8Array([1]) }, m),
  );
  const tx = await partiallySignTransaction([payer.keyPair], compileTransaction(msg));
  const accept = { scheme: "exact", network: SOLANA_NETWORK, payTo: rc.accepts[0].payTo, amount: "10000", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" };
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: accept, payload: { transaction: getBase64EncodedWireTransaction(tx) } })).toString("base64");
}

test("requirements: Solana-only USDC routes get receipts; '$0.01' and unit prices both convert", () => {
  assert.equal(moneyToAtomic("$0.01"), "10000");
  assert.equal(moneyToAtomic("$0.001"), "1000");
  const rc = buildSolanaOnlyRouteConfig("$0.01", "d", "/api/alpha/portfolio/current");
  assert.deepEqual(solanaRequirement(rc), { network: SOLANA_NETWORK, payTo: rc.accepts[0].payTo, asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "10000" });
  assert.equal(solanaRequirement(buildSolanaOnlyRouteConfig(solanaUsdcUnits("1000"), "d", "/api/edinet/:code")).amount, "1000");
  assert.equal(solanaRequirement({ accepts: [] }), null);
});

test("a refetch is served from the stored delivery without verify/settle, with a receipt that verifies", async () => {
  const rc = buildSolanaOnlyRouteConfig("$0.01", "d", "/api/alpha/portfolio/current");
  let handlerCalls = 0;
  const route = withX402AndInternal(async () => {
    handlerCalls++;
    return Response.json({ fresh: true });
  }, rc, x402Server);
  const url = "https://osd.x402jp.com/api/alpha/portfolio/current";
  const header = await paymentHeader(rc);
  const body = new TextEncoder().encode(JSON.stringify({ current: ["AAPL"] }));
  const seller = receiptSeller();
  const first = await seller.recordFirstDelivery({
    requirement: solanaRequirement(rc), resource: url, paymentHeader: header,
    settle: { success: true, transaction: TX, network: SOLANA_NETWORK }, body, contentType: "application/json",
  });
  assert.ok(first, "first delivery recorded");

  const settleBefore = x402Server.settlePayment;
  let settled = 0;
  x402Server.settlePayment = async (...a) => { settled++; return settleBefore.apply(x402Server, a); };
  try {
    const res = await route(new NextRequest(url, { headers: { "PAYMENT-SIGNATURE": header, "X-Payment-Refetch": TX } }));
    assert.equal(res.status, 200);
    const got = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Buffer.from(got), Buffer.from(body), "the stored body, not a fresh one");
    assert.equal(handlerCalls, 0);
    assert.equal(settled, 0, "no settlement on a refetch");
    const v = verifyReceipt({ header: res.headers.get("X-Delivery-Receipt"), body: got, wellKnown: seller.wellKnown(), expect: { payment_id: TX, resource: url } });
    assert.equal(v.ok, true);
    assert.equal(v.receipt.delivery, "refetch");
    assert.match(res.headers.get("Access-Control-Expose-Headers"), /X-Delivery-Receipt/);

    const other = await paymentHeader(rc);
    const bad = await route(new NextRequest(url, { headers: { "PAYMENT-SIGNATURE": other, "X-Payment-Refetch": TX } }));
    assert.equal(bad.status, 402, "another payer's header cannot refetch");
  } finally {
    x402Server.settlePayment = settleBefore;
  }
});

test("without RECEIPT_SIGNING_KEY the server does not start", async () => {
  const keep = process.env.RECEIPT_SIGNING_KEY;
  try {
    process.env.RECEIPT_SIGNING_KEY = "";
    const { createReceiptSeller, FileStore } = await import("../../lib/delivery-receipt/index.ts");
    assert.throws(() => createReceiptSeller({ store: new FileStore(process.env.RECEIPT_STORE_DIR) }), /RECEIPT_SIGNING_KEY/);
  } finally {
    process.env.RECEIPT_SIGNING_KEY = keep;
  }
});
