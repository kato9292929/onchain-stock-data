/**
 * A 402 that carries no challenge is not a challenge.
 *
 * On 2026-10-08 five paid routes answered `HTTP 402 {}` all day. The buyer's
 * agent read that as "pay me", re-presented a payment, got 402 again, and gave
 * up — having been told nothing true. The real cause was ours: PayAI's pooled
 * free-tier allowance ran out mid-settle (`free_tier_exhausted`).
 *
 * That 402 is not an SDK accident. `@x402/core` answers every failed
 * settlement from `buildSettlementFailureResponse`, which hardcodes
 * `status: 402`, leaves the body `{}`, and attaches the settle receipt as
 * `PAYMENT-RESPONSE` — with no `PAYMENT-REQUIRED`. `@x402/next` returns it
 * verbatim. So the seller's billing problem is expressed to the buyer as a
 * demand for payment, by design.
 *
 * The buyer never paid and was never at risk. But they also had no way to know
 * that from the response, and neither did we — the cause was only found by
 * reading the buyer's own run log days later. So the invariant is pinned here:
 * a 402 is a challenge or it is not a 402.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { asPaymentUnavailable } = await import("../../lib/x402-route.ts");

const route = { resource: "https://osd.x402jp.com/api/alpha/portfolio/current" };
const res = (status, headers = {}) =>
  new Response(JSON.stringify({}), { status, headers });

// The receipt observed on 2026-10-08, clipped out of the buyer's dashboard —
// which is why the outage took days to diagnose. It belongs in the body.
const RECEIPT =
  '{"success":false,"errorReason":"free_tier_exhausted: ... purchase credits"}';

test("the shape seen on 2026-10-08 becomes 503, receipt and all", async () => {
  // 402 + `{}` + PAYMENT-RESPONSE, no PAYMENT-REQUIRED: exactly what
  // buildSettlementFailureResponse emits, and exactly what production returned.
  const out = asPaymentUnavailable(res(402, { "PAYMENT-RESPONSE": RECEIPT }), route);
  assert.equal(out.status, 503);
  assert.equal(out.headers.get("Retry-After"), "60");
  const body = await out.json();
  assert.equal(body.error, "payment_unavailable");
  assert.match(body.message, /Nothing was charged/, "the buyer must be told this");
  assert.equal(body.facilitator_receipt, RECEIPT, "the facilitator's own words");
});

test("a header-less 402 becomes 503 even with no receipt to pass on", async () => {
  // @x402/next's settlement catch emits 402 with only Content-Type. It is
  // near-unreachable — processSettlement converts every throw into a failure
  // response except FacilitatorResponseError, which becomes a 502 — but the
  // header check covers it, and a missing receipt must not break the rewrite.
  const out = asPaymentUnavailable(res(402), route);
  assert.equal(out.status, 503);
  const body = await out.json();
  assert.equal(body.error, "payment_unavailable");
  assert.equal(body.facilitator_receipt, null);
});

test("a real challenge is left exactly as it is", () => {
  // Every unpaid route on this host sends PAYMENT-REQUIRED; that header is what
  // the buyer pays against. Rewriting one of these would break the protocol.
  const challenge = res(402, { "PAYMENT-REQUIRED": "eyJ4NDAyVmVyc2lvbiI6Mn0=" });
  assert.equal(asPaymentUnavailable(challenge, route), challenge);
});

test("PAYMENT-REQUIRED wins when both headers are present", () => {
  // A failed verify re-challenges rather than going silent, so a 402 can carry
  // a challenge and a receipt at once. Payable beats explanatory: leave it.
  const challenge = res(402, {
    "PAYMENT-REQUIRED": "eyJ4NDAyVmVyc2lvbiI6Mn0=",
    "PAYMENT-RESPONSE": RECEIPT,
  });
  assert.equal(asPaymentUnavailable(challenge, route), challenge);
});

test("header matching is case-insensitive", () => {
  const challenge = res(402, { "payment-required": "eyJ4NDAyVmVyc2lvbiI6Mn0=" });
  assert.equal(asPaymentUnavailable(challenge, route), challenge);
});

test("nothing else is touched", () => {
  for (const status of [200, 404, 412, 500, 502, 503]) {
    // 412 is the SDK's permit2-allowance status and carries a challenge of its
    // own; it is not ours to rewrite either.
    const r = res(status);
    assert.equal(asPaymentUnavailable(r, route), r, `status ${status}`);
  }
});
