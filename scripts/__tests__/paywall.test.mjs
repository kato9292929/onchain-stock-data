/**
 * x402 paywall wiring (A4).
 *
 * A true end-to-end "unpaid request → 402" needs the x402 SDK to reach the CDP
 * facilitator (initialize()), which this sandbox blocks by egress policy. So we
 * assert the wiring structurally: each wrapper route goes through withX402 with
 * the right price + resourcePath, and lets X-Internal-Key bypass payment. The
 * live 402 is confirmed by the deploy smoke test (see PR description).
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

test("birdeye route is x402-wrapped at $0.01 with internal bypass", async () => {
  const src = await routeSrc("app/api/wrappers/birdeye-ohlcv/route.ts");
  assert.match(src, /withX402\(/);
  assert.match(src, /"\$0\.01"/);
  assert.match(src, /"\/api\/wrappers\/birdeye-ohlcv"/);
  assert.match(src, /isInternalAuthed\(req\)/);
  assert.match(src, /true, \/\/ syncFacilitatorOnStart/);
});

test("perplexity route is x402-wrapped at $0.05 with internal bypass", async () => {
  const src = await routeSrc("app/api/wrappers/perplexity-research/route.ts");
  assert.match(src, /withX402\(/);
  assert.match(src, /"\$0\.05"/);
  assert.match(src, /"\/api\/wrappers\/perplexity-research"/);
  assert.match(src, /isInternalAuthed\(req\)/);
  assert.match(src, /true, \/\/ syncFacilitatorOnStart/);
});

test("wrapper routes are force-dynamic and CORS-open", async () => {
  for (const p of [
    "app/api/wrappers/birdeye-ohlcv/route.ts",
    "app/api/wrappers/perplexity-research/route.ts",
  ]) {
    const src = await routeSrc(p);
    assert.match(src, /export const dynamic = "force-dynamic"/);
    assert.match(src, /Access-Control-Allow-Origin/);
    assert.match(src, /export function OPTIONS/);
  }
});
