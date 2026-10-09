/**
 * A 402 that carries no challenge is not a challenge.
 *
 * On 2026-10-08 five paid routes answered `HTTP 402 {}` all day. The buyer's
 * agent read that as "pay me", re-presented a payment, got 402 again, and gave
 * up — having been told nothing true. The real cause was ours: PayAI's pooled
 * free-tier allowance ran out mid-settle (`free_tier_exhausted`), which
 * `@x402/next` reports by returning a bare 402 with no PAYMENT-REQUIRED header.
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

test("a settlement failure becomes 503, not an unpayable 402", async () => {
  const out = asPaymentUnavailable(res(402), route);
  assert.equal(out.status, 503);
  assert.equal(out.headers.get("Retry-After"), "60");
  const body = await out.json();
  assert.equal(body.error, "payment_unavailable");
  assert.match(body.message, /Nothing was charged/, "the buyer must be told this");
});

test("the facilitator's own reason is passed through, not swallowed", async () => {
  // This exact string was clipped out of the buyer's dashboard, which is why
  // the outage took days to diagnose. It belongs in the response body.
  const receipt =
    '{"success":false,"errorReason":"free_tier_exhausted: ... purchase credits"}';
  const out = asPaymentUnavailable(
    res(402, { "PAYMENT-RESPONSE": receipt }),
    route,
  );
  const body = await out.json();
  assert.equal(body.facilitator_receipt, receipt);
});

test("a real challenge is left exactly as it is", () => {
  // Every unpaid route on this host sends PAYMENT-REQUIRED; that header is what
  // the buyer pays against. Rewriting one of these would break the protocol.
  const challenge = res(402, { "PAYMENT-REQUIRED": "eyJ4NDAyVmVyc2lvbiI6Mn0=" });
  assert.equal(asPaymentUnavailable(challenge, route), challenge);
});

test("header matching is case-insensitive", () => {
  const challenge = res(402, { "payment-required": "eyJ4NDAyVmVyc2lvbiI6Mn0=" });
  assert.equal(asPaymentUnavailable(challenge, route), challenge);
});

test("nothing else is touched", () => {
  for (const status of [200, 404, 500, 502, 503]) {
    const r = res(status);
    assert.equal(asPaymentUnavailable(r, route), r, `status ${status}`);
  }
});
