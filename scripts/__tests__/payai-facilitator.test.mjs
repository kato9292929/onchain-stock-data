/**
 * PayAI (Solana) facilitator wiring — Base non-interference.
 *
 * 1) The @payai/facilitator config points at the PayAI facilitator URL and is
 *    structurally a FacilitatorConfig (url / optional createAuthHeaders).
 * 2) lib/x402.ts exposes isPayAISolanaEnabled and an x402Server that registers
 *    both EVM + SVM schemes.
 * 3) The SDK's multi-facilitator routing (mock getSupported) sends Base verify
 *    to the CDP client and Solana verify to the PayAI client — and a CDP-only
 *    array still verifies Base with NO Solana route (regression-safe default).
 *
 * No network: facilitator HTTP is mocked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFacilitatorConfig, facilitator } from "@payai/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

const BASE = "eip155:8453";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// ── 1) PayAI package export shape (verified, not guessed) ───────────────
test("PayAI facilitator config targets the PayAI facilitator URL", () => {
  assert.equal(typeof facilitator, "object");
  assert.match(facilitator.url, /^https:\/\/facilitator\.payai\.network/);

  const cfg = createFacilitatorConfig();
  assert.match(cfg.url, /^https:\/\/facilitator\.payai\.network/);

  // With credentials, an auth-header factory is attached (JWT bearer).
  const authed = createFacilitatorConfig("kid", "payai_sk_secret");
  assert.equal(typeof authed.createAuthHeaders, "function");
});

// ── 2) lib/x402.ts exports the PayAI flag + a dual-scheme server ─────────
test("lib/x402.ts wires PayAI and registers EVM + SVM", async () => {
  const x402 = await import("../../lib/x402.ts");
  assert.equal("isPayAISolanaEnabled" in x402, true);
  // Package is installed here, so construction should succeed.
  assert.equal(x402.isPayAISolanaEnabled, true);
  assert.ok(x402.x402Server, "x402Server is exported");
});

// ── 3) Multi-facilitator routing: Base→CDP, Solana→PayAI ────────────────
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

test("CDP-first array routes Base to CDP and Solana to PayAI", async () => {
  const cdp = mockClient(BASE); // stands in for the CDP (Base) facilitator
  const payai = mockClient(SOLANA); // stands in for the PayAI (Solana) facilitator
  const server = new x402ResourceServer([cdp, payai]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();

  assert.equal(server.getFacilitatorClient(2, BASE, "exact"), cdp, "Base → CDP");
  assert.equal(server.getFacilitatorClient(2, SOLANA, "exact"), payai, "Solana → PayAI");
});

test("CDP-only array (PayAI absent) keeps Base, no Solana route (regression-safe)", async () => {
  const cdp = mockClient(BASE);
  const server = new x402ResourceServer([cdp]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();

  assert.equal(server.getFacilitatorClient(2, BASE, "exact"), cdp, "Base still verifiable via CDP");
  assert.equal(
    server.getFacilitatorClient(2, SOLANA, "exact"),
    undefined,
    "Solana has no facilitator when PayAI is absent",
  );
});

test("earlier client wins: CDP precedence preserved for Base", async () => {
  // If both advertised Base, the first (CDP) must win — Base never moves off CDP.
  const cdp = mockClient(BASE);
  const other = mockClient(BASE);
  const server = new x402ResourceServer([cdp, other]);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();
  assert.equal(server.getFacilitatorClient(2, BASE, "exact"), cdp, "first client wins for Base");
});
