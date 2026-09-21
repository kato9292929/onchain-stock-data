/**
 * /.well-known/x402.json must describe the API that actually ships.
 *
 * The descriptor is hand-maintained metadata for directory crawlers
 * (x402scan / Pay.sh), so nothing but a test stops it from drifting away from
 * the routes — which is exactly how README and the article template ended up
 * advertising ten endpoints that had been deleted. These assertions bind every
 * advertised path to a route file on disk, and every advertised price to the
 * constant the route charges with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const { GET } = await import("../../app/.well-known/x402.json/route.ts");
const {
  PER_CALL_PRICE,
  SOLANA_NETWORK,
  BASE_NETWORK,
  ASSET_SOLANA_USDC,
  PUBLIC_BASE_URL,
} = await import("../../lib/x402.ts");

const body = await GET().json();

/** "/api/catalyst/:ticker" → "app/api/catalyst/[ticker]/route.ts" */
function routeFileFor(apiPath) {
  const segs = apiPath.split("/").filter(Boolean);
  const mapped = segs.map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s));
  return path.join(repoRoot, "app", ...mapped, "route.ts");
}

const paidPaths = body.endpoints.map((e) => e.path);
const freePaths = body.free_endpoints.map((e) => e.path);

test("every advertised path resolves to a route file that ships", () => {
  const advertised = [
    ...paidPaths,
    ...freePaths,
    ...body.testnet_endpoints.map((e) => e.path),
    new URL(body.mcp.url).pathname,
  ];
  for (const p of advertised) {
    assert.ok(existsSync(routeFileFor(p)), `${p} is advertised but has no route file`);
  }
});

test("removed endpoints are not advertised anywhere", () => {
  const json = JSON.stringify(body);
  for (const gone of [
    "/api/stocks",
    "/api/ipo",
    "/api/liquidity",
    "/api/holders",
    "/api/analyst",
    "/api/predict",
    "/api/alpha-posts",
    "/api/wrappers",
  ]) {
    assert.ok(!json.includes(gone), `${gone} was removed from the app but is still advertised`);
  }
});

test("the free surface carries no payment legs", () => {
  for (const e of body.free_endpoints) {
    assert.equal(e.accepts, undefined, `${e.path} is listed as free but has accepts`);
  }
  assert.equal(body.mcp.auth, "none");
});

test("per-call endpoints advertise PER_CALL_PRICE, Solana-only", () => {
  const perCall = body.endpoints.filter((e) =>
    ["/api/catalyst/:ticker", "/api/edinet/:code"].includes(e.path),
  );
  assert.equal(perCall.length, 2, "both per-call endpoints must be advertised");
  for (const e of perCall) {
    assert.equal(e.accepts.length, 1, `${e.path} must offer exactly one leg`);
    const [leg] = e.accepts;
    assert.equal(leg.network, SOLANA_NETWORK);
    assert.equal(leg.asset, ASSET_SOLANA_USDC);
    assert.equal(leg.amount, PER_CALL_PRICE.base_units);
    assert.equal(leg.scheme, PER_CALL_PRICE.scheme);
  }
});

test("the /api/alpha surface advertises $0.01 on both chains", () => {
  const alpha = body.endpoints.filter((e) => e.path.startsWith("/api/alpha/"));
  assert.ok(alpha.length >= 7, "the alpha surface should still be advertised");
  for (const e of alpha) {
    assert.equal(e.accepts.length, 2, `${e.path} must offer Base + Solana`);
    assert.deepEqual(
      e.accepts.map((a) => a.network).sort(),
      [BASE_NETWORK, SOLANA_NETWORK].sort(),
    );
    for (const leg of e.accepts) {
      // $0.01 in atomic USDC (6 decimals).
      assert.equal(leg.amount, "10000", `${e.path} must charge $0.01`);
    }
  }
});

test("the testnet demo is kept out of the payable mainnet list", () => {
  assert.ok(
    !paidPaths.includes("/api/testnet/signal"),
    "the Base Sepolia demo must not be advertised as a payable mainnet resource",
  );
  const [demo] = body.testnet_endpoints;
  assert.equal(demo.network, "eip155:84532");
});

test("resource URLs use the canonical public origin", () => {
  for (const e of body.endpoints) {
    for (const leg of e.accepts) {
      assert.ok(leg.resource.startsWith(PUBLIC_BASE_URL), `${e.path} leg escapes ${PUBLIC_BASE_URL}`);
    }
  }
  assert.equal(body.base_url, PUBLIC_BASE_URL);
});
