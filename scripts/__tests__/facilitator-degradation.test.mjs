/**
 * One dead facilitator must not take down the chains that still work.
 *
 * `x402ResourceServer.buildPaymentRequirements` throws for a network whose
 * facilitator never reported its supported kinds, and the loop over `accepts`
 * does not catch it — so a CDP (Base) outage would 500 every unpaid request on
 * a dual-leg /api/alpha/* route even though PayAI is settling Solana normally.
 * These tests pin the real SDK behaviour that makes that happen, and the
 * filter lib/x402-route.ts applies to survive it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

const { verifiableAccepts } = await import("../../lib/x402-route.ts");
const { buildRouteConfig, ASSET_SOLANA_USDC } = await import("../../lib/x402.ts");

const BASE = "eip155:8453";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** A facilitator client that advertises exactly one network. */
function mockClient(network) {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, network, scheme: "exact", extra: {} }],
      extensions: [],
    }),
    verify: async () => ({ isValid: true }),
    settle: async () => ({ success: true }),
  };
}

/** A client standing in for an unreachable facilitator (outage / revoked key). */
function deadClient() {
  return {
    getSupported: async () => {
      throw new Error("Facilitator getSupported failed (403): unreachable");
    },
    verify: async () => ({ isValid: false }),
    settle: async () => ({ success: false }),
  };
}

async function serverWith(clients) {
  const server = new x402ResourceServer(clients);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();
  return server;
}

const dualLeg = () =>
  buildRouteConfig({ amount: "1000", asset: ASSET_SOLANA_USDC }, "test", "/api/test");

test("SDK throws while building a 402 when one leg's facilitator is dead", async () => {
  // Solana is healthy, Base is not — the exact shape of a CDP outage.
  const server = await serverWith([deadClient(), mockClient(SOLANA)]);
  const config = dualLeg();

  await assert.rejects(
    () => server.buildPaymentRequirementsFromOptions(config.accepts, undefined),
    /Facilitator does not support/,
    "the SDK must still fail closed on the dead leg — if this stops throwing, the degradation path in lib/x402-route.ts can be simplified",
  );
});

test("verifiableAccepts keeps the healthy leg and drops the dead one", async () => {
  const server = await serverWith([deadClient(), mockClient(SOLANA)]);
  const live = verifiableAccepts(dualLeg(), server);

  assert.equal(live.length, 1, "exactly one leg survives");
  assert.equal(live[0].network, SOLANA, "the surviving leg is Solana");
});

test("the filtered config builds a 402 the dual-leg config could not", async () => {
  const server = await serverWith([deadClient(), mockClient(SOLANA)]);
  const config = dualLeg();
  const live = verifiableAccepts(config, server);

  const requirements = await server.buildPaymentRequirementsFromOptions(live, undefined);
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0].network, SOLANA);
  assert.equal(requirements[0].amount, "1000", "the price is untouched by degradation");
});

test("both facilitators healthy → nothing is dropped", async () => {
  const server = await serverWith([mockClient(BASE), mockClient(SOLANA)]);
  const live = verifiableAccepts(dualLeg(), server);

  assert.equal(live.length, 2, "a healthy pair keeps both legs");
  assert.deepEqual(live.map((l) => l.network).sort(), [BASE, SOLANA].sort());
});

test("every facilitator dead → no leg is verifiable (route must 503, not 200)", async () => {
  // initialize() itself throws when nothing loads; the route still has to
  // decide what to serve, and it must not be a free 200.
  const server = new x402ResourceServer([deadClient()]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await assert.rejects(() => server.initialize(), /no supported payment kinds loaded/);

  assert.equal(verifiableAccepts(dualLeg(), server).length, 0);
});

// ── the wrapper end to end ────────────────────────────────────────────────
const { NextRequest, NextResponse } = await import("next/server");
const { withX402AndInternal } = await import("../../lib/x402-route.ts");

const ok = async () => NextResponse.json({ ok: true });
const request = () => new NextRequest("https://osd.x402jp.com/api/test");

test("a dead Base facilitator yields a degraded 402, not a 500", async () => {
  const server = await serverWith([deadClient(), mockClient(SOLANA)]);
  const route = withX402AndInternal(ok, dualLeg(), server);

  const res = await route(request());
  assert.equal(res.status, 402, "the caller is still told how to pay");

  const challenge = res.headers.get("payment-required");
  assert.ok(challenge, "the v2 challenge header is present");
  const decoded = JSON.parse(Buffer.from(challenge, "base64").toString());
  assert.equal(decoded.accepts.length, 1, "only the healthy leg is offered");
  assert.equal(decoded.accepts[0].network, SOLANA);
});

test("every facilitator dead yields 503 + Retry-After, never a free 200", async () => {
  const server = new x402ResourceServer([deadClient()]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  const route = withX402AndInternal(ok, dualLeg(), server);

  const res = await route(request());
  assert.equal(res.status, 503, "a temporary upstream failure, not 500 and not a free 200");
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal((await res.json()).error, "payment_unavailable");
});
