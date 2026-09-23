/**
 * Facilitator network scoping.
 *
 * Production failure this locks out: the paid routes were Solana-only, the
 * buyer signed correctly, and the seller still answered 402 with an empty body.
 * Cause — `x402ResourceServer.initialize()` keeps the FIRST client that claims a
 * given (version, network, scheme), and CDP advertises Solana as well as EVM.
 * With CDP listed first it therefore owned `solana:*` too, and a CDP account
 * past its free tier fails settlement AFTER the buyer has signed.
 *
 * The other tests in solana-verify-routing.test.mjs mock each facilitator as
 * advertising only its own network, which is the assumption that did not hold.
 * Here the CDP mock advertises BOTH, as the real one does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "eip155:8453";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** A facilitator that advertises several networks, tagged so we can tell who served. */
function mockClient(id, networks) {
  return {
    id,
    getSupported: async () => ({
      kinds: networks.map((network) => ({ x402Version: 2, network, scheme: "exact", extra: {} })),
      extensions: [],
    }),
    verify: async () => ({ isValid: true, servedBy: id }),
    settle: async () => ({ success: true, servedBy: id }),
  };
}

/** Same shape as scopeToNetworks in lib/x402.ts. */
function scope(inner, allow) {
  return {
    async getSupported() {
      const s = await inner.getSupported();
      return { ...s, kinds: s.kinds.filter((k) => allow(String(k.network))) };
    },
    verify: (a, b) => inner.verify(a, b),
    settle: (a, b) => inner.settle(a, b),
  };
}

const isEvm = (n) => n === "base" || n.startsWith("eip155:");
const isSolana = (n) => n === "solana" || n.startsWith("solana:");

async function build(clients) {
  const server = new x402ResourceServer(clients);
  registerExactEvmScheme(server);
  registerExactSvmScheme(server);
  await server.initialize();
  return server;
}

test("regression: unscoped, a CDP-first array hands Solana to CDP", async () => {
  // This is the production bug, reproduced. CDP advertises both networks and is
  // listed first, so it wins solana:* — the buyer signs, then settlement fails.
  const cdp = mockClient("cdp", [BASE, SOLANA]);
  const payai = mockClient("payai", [SOLANA]);
  const server = await build([cdp, payai]);

  const fac = server.getFacilitatorClient(2, SOLANA, "exact");
  const settled = await fac.settle({ x402Version: 2 }, { network: SOLANA, scheme: "exact" });
  assert.equal(settled.servedBy, "cdp", "前提: 素の配列では CDP が Solana を取る");
});

test("scoped: Solana settles through PayAI even though CDP advertises it", async () => {
  const cdp = mockClient("cdp", [BASE, SOLANA]);
  const payai = mockClient("payai", [SOLANA]);
  const server = await build([scope(cdp, isEvm), scope(payai, isSolana)]);

  const solFac = server.getFacilitatorClient(2, SOLANA, "exact");
  const baseFac = server.getFacilitatorClient(2, BASE, "exact");
  assert.equal((await solFac.settle({}, {})).servedBy, "payai", "Solana は PayAI");
  assert.equal((await baseFac.settle({}, {})).servedBy, "cdp", "Base は CDP のまま");
});

test("scoped: order no longer changes the outcome", async () => {
  const cdp = mockClient("cdp", [BASE, SOLANA]);
  const payai = mockClient("payai", [SOLANA]);
  const reversed = await build([scope(payai, isSolana), scope(cdp, isEvm)]);

  assert.equal(
    (await reversed.getFacilitatorClient(2, SOLANA, "exact").settle({}, {})).servedBy,
    "payai",
  );
  assert.equal(
    (await reversed.getFacilitatorClient(2, BASE, "exact").settle({}, {})).servedBy,
    "cdp",
  );
});

test("scoped: without PayAI, Solana has no facilitator (503, not a silent CDP settle)", async () => {
  const cdp = mockClient("cdp", [BASE, SOLANA]);
  const server = await build([scope(cdp, isEvm)]);

  assert.ok(server.getFacilitatorClient(2, BASE, "exact"), "Base はそのまま");
  assert.equal(
    server.getFacilitatorClient(2, SOLANA, "exact"),
    undefined,
    "PayAI 不在なら Solana は未対応として落ちる（CDP が肩代わりしない）",
  );
});

test("lib/x402.ts actually applies the scoping to both clients", async () => {
  const src = await readFile(path.join(REPO, "lib/x402.ts"), "utf8");
  assert.match(src, /function scopeToNetworks\(/);
  assert.match(src, /scopeToNetworks\(cdpFacilitatorClient,\s*"CDP",\s*isEvmNetwork\)/);
  assert.match(src, /scopeToNetworks\(payaiFacilitatorClient,\s*"PayAI",\s*isSolanaNetwork\)/);
});
