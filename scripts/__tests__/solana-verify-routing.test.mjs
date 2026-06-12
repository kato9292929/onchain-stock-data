/**
 * Section B — Solana payment verification routing.
 *
 * Builds an x402ResourceServer with two mock facilitator clients: one that
 * advertises Base (EVM) kinds, one that advertises Solana kinds. After
 * initialize(), asserts the server routes verification per network — a Solana
 * payment proof is verified by the Solana facilitator, Base by the CDP one —
 * and that an unsupported network has no facilitator (→ challenge, not verify).
 *
 * This exercises the real SDK path (getFacilitatorClient) that lib/x402.ts now
 * relies on, with the facilitator HTTP call mocked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

const BASE = "eip155:8453";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function mockClient(network, scheme, verifyImpl) {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, network, scheme, extra: {} }],
      extensions: [],
    }),
    verify: verifyImpl ?? (async () => ({ isValid: true })),
    settle: async () => ({ success: true }),
  };
}

test("resource server routes verify per network to the right facilitator", async () => {
  let baseVerifyCalls = 0;
  let solVerifyCalls = 0;
  const baseClient = mockClient(BASE, "exact", async () => {
    baseVerifyCalls += 1;
    return { isValid: true };
  });
  const solClient = mockClient(SOLANA, "exact", async () => {
    solVerifyCalls += 1;
    return { isValid: true };
  });

  const server = new x402ResourceServer([baseClient, solClient]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();

  // Both networks must now resolve to a facilitator client.
  const baseFac = server.getFacilitatorClient(2, BASE, "exact");
  const solFac = server.getFacilitatorClient(2, SOLANA, "exact");
  assert.ok(baseFac, "Base has a facilitator");
  assert.ok(solFac, "Solana has a facilitator");

  // Routing is per-network: the Solana facilitator is the solClient.
  await solFac.verify({ x402Version: 2 }, { network: SOLANA, scheme: "exact" });
  await baseFac.verify({ x402Version: 2 }, { network: BASE, scheme: "exact" });
  assert.equal(solVerifyCalls, 1, "Solana proof verified by Solana facilitator");
  assert.equal(baseVerifyCalls, 1, "Base proof verified by Base facilitator");
});

test("without a Solana facilitator, Solana has no verifier (challenge-only)", async () => {
  const baseClient = mockClient(BASE, "exact");
  const server = new x402ResourceServer([baseClient]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();

  assert.ok(server.getFacilitatorClient(2, BASE, "exact"), "Base verifiable");
  assert.equal(
    server.getFacilitatorClient(2, SOLANA, "exact"),
    undefined,
    "Solana not verifiable until a Solana facilitator is configured",
  );
});

test("invalid Solana proof → facilitator returns isValid:false", async () => {
  const solClient = mockClient(SOLANA, "exact", async () => ({
    isValid: false,
    invalidReason: "wrong payTo / amount / mint",
  }));
  const server = new x402ResourceServer([mockClient(BASE, "exact"), solClient]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();

  const fac = server.getFacilitatorClient(2, SOLANA, "exact");
  const res = await fac.verify({ x402Version: 2 }, { network: SOLANA, scheme: "exact" });
  assert.equal(res.isValid, false, "bad proof is rejected (route returns 402)");
});
