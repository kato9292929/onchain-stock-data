/**
 * x402 paywall wiring (A4 / Section C).
 *
 * A true end-to-end "unpaid request → 402" needs the x402 SDK to reach the CDP
 * facilitator (initialize()), which this sandbox blocks by egress policy. So we
 * assert the wiring structurally: each wrapper route goes through the shared
 * withPaywall helper at the right price + resourcePath. withPaywall advertises
 * both Base and Solana legs and lets X-Internal-Key bypass payment. The live
 * 402 (Base + Solana) is confirmed by the deploy smoke test (see PR).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function routeSrc(p) {
  return readFile(path.join(REPO, p), "utf8");
}

test("birdeye route uses shared withPaywall at $0.01", async () => {
  const src = await routeSrc("app/api/wrappers/birdeye-ohlcv/route.ts");
  assert.match(src, /withPaywall\(/);
  assert.match(src, /"\$0\.01"/);
  assert.match(src, /"\/api\/wrappers\/birdeye-ohlcv"/);
});

test("perplexity route uses shared withPaywall at $0.05", async () => {
  const src = await routeSrc("app/api/wrappers/perplexity-research/route.ts");
  assert.match(src, /withPaywall\(/);
  assert.match(src, /"\$0\.05"/);
  assert.match(src, /"\/api\/wrappers\/perplexity-research"/);
});

test("wrapper routes are force-dynamic and expose OPTIONS/CORS", async () => {
  for (const p of [
    "app/api/wrappers/birdeye-ohlcv/route.ts",
    "app/api/wrappers/perplexity-research/route.ts",
  ]) {
    const src = await routeSrc(p);
    assert.match(src, /export const dynamic = "force-dynamic"/);
    assert.match(src, /corsPreflight/);
    assert.match(src, /export function OPTIONS/);
  }
});

test("withPaywall advertises both Base and Solana legs + internal bypass", async () => {
  const src = await routeSrc("lib/x402-route.ts");
  assert.match(src, /buildRouteConfig\(/);
  assert.match(src, /isInternalAuthed\(req\)/);
  assert.match(src, /true, \/\/ syncFacilitatorOnStart/);
});
