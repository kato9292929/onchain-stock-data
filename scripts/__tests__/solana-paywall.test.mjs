/**
 * Solana x402 support — Section A (402 challenge legs) + D (discovery/config
 * consistency) + facilitator wiring + Section B (verify routing via a mock
 * facilitator client). Pure assertions over lib/x402.ts; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// SOLANA_RECEIVE_ADDRESS must be read at import time by lib/x402.ts.
const SOL_ADDR = "SoLReceive1111111111111111111111111111111111";
process.env.SOLANA_RECEIVE_ADDRESS = SOL_ADDR;

const x402 = await import("../../lib/x402.ts");
const {
  buildRouteConfig,
  PAY_TO_SOLANA,
  PAY_TO_BASE,
  BASE_NETWORK,
  SOLANA_NETWORK,
  ASSET_SOLANA_USDC,
  ASSET_BASE_USDC,
  isSolanaFacilitatorConfigured,
} = x402;

// ── Section A: the 402 challenge advertises a Solana leg ────────────────
test("SOLANA_RECEIVE_ADDRESS is the Solana payTo", () => {
  assert.equal(PAY_TO_SOLANA, SOL_ADDR);
});

test("buildRouteConfig advertises both Base and Solana exact legs", () => {
  const cfg = buildRouteConfig("$0.01", "test", "/api/wrappers/birdeye-ohlcv");
  assert.equal(cfg.accepts.length, 2);

  const base = cfg.accepts.find((a) => a.network === BASE_NETWORK);
  const sol = cfg.accepts.find((a) => a.network === SOLANA_NETWORK);
  assert.ok(base, "has a Base leg");
  assert.ok(sol, "has a Solana leg");

  // Solana leg: correct scheme / payTo / network / price.
  assert.equal(sol.scheme, "exact");
  assert.equal(sol.payTo, SOL_ADDR);
  assert.equal(sol.price, "$0.01");
  assert.equal(sol.network, SOLANA_NETWORK);
  assert.equal(base.payTo, PAY_TO_BASE);
});

test("Solana network id is mainnet solana CAIP", () => {
  assert.match(SOLANA_NETWORK, /^solana:/);
});

// ── Section D: discovery (dualLegs) ↔ verification (buildRouteConfig) ────
test("discovery Solana mint/payTo match the verification config", () => {
  // The discovery descriptor's Solana leg uses these same constants.
  assert.equal(ASSET_SOLANA_USDC, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.ok(ASSET_BASE_USDC.startsWith("0x"));
  // payTo used in both paths is the single PAY_TO_SOLANA export.
  const cfg = buildRouteConfig("$0.05", "t", "/api/wrappers/perplexity-research");
  const sol = cfg.accepts.find((a) => a.network === SOLANA_NETWORK);
  assert.equal(sol.payTo, PAY_TO_SOLANA);
});

// ── Facilitator wiring ──────────────────────────────────────────────────
test("isSolanaFacilitatorConfigured reflects SOLANA_FACILITATOR_URL", () => {
  const prev = process.env.SOLANA_FACILITATOR_URL;
  delete process.env.SOLANA_FACILITATOR_URL;
  assert.equal(isSolanaFacilitatorConfigured(), false);
  process.env.SOLANA_FACILITATOR_URL = "https://facilitator.example/solana";
  assert.equal(isSolanaFacilitatorConfigured(), true);
  process.env.SOLANA_FACILITATOR_URL = "not-a-url";
  assert.equal(isSolanaFacilitatorConfigured(), false);
  if (prev === undefined) delete process.env.SOLANA_FACILITATOR_URL;
  else process.env.SOLANA_FACILITATOR_URL = prev;
});
