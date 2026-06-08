/**
 * Section B tests — AA external-data fetch + graceful degradation + prompt
 * formatting. Uses an injected fetch mock; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchExternalData,
  formatExternalDataForPrompt,
} from "../../lib/external-data.ts";

const sample = {
  birdeye: [{ ticker: "NVDA", summary: "30d +12%, vol rising" }],
  perplexity: [
    {
      ticker: "NVDA",
      title: "AI revenue beat",
      date: "2026-08-28",
      source_url: "https://x/1",
      catalyst_suggestion: "2026-08-28 + AI rev > $4.5B",
    },
  ],
};

function mockFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

test("AA 200 → external data returned and appears in prompt", async () => {
  const data = await fetchExternalData({ url: "https://aa/x", fetchImpl: mockFetch(200, sample) });
  assert.ok(data);
  const ctx = formatExternalDataForPrompt(data);
  assert.match(ctx, /External alt data \(from AA via x402\)/);
  assert.match(ctx, /Birdeye OHLCV/);
  assert.match(ctx, /NVDA: 30d \+12%/);
  assert.match(ctx, /Perplexity recent news/);
  assert.match(ctx, /AI revenue beat/);
  assert.match(ctx, /catalyst: 2026-08-28/);
});

test("AA 5xx → null (graceful degradation), prompt section empty", async () => {
  const data = await fetchExternalData({ url: "https://aa/x", fetchImpl: mockFetch(503, {}) });
  assert.equal(data, null);
  assert.equal(formatExternalDataForPrompt(data), "");
});

test("AA timeout/abort → null (no throw)", async () => {
  const aborting = async (_url, opts) =>
    new Promise((_res, rej) => {
      const e = new Error("aborted");
      e.name = "AbortError";
      if (opts?.signal) opts.signal.addEventListener("abort", () => rej(e));
      rej(e);
    });
  const data = await fetchExternalData({ url: "https://aa/x", fetchImpl: aborting });
  assert.equal(data, null);
});

test("no AA_EXTERNAL_DATA_URL → null without fetching", async () => {
  let called = false;
  const data = await fetchExternalData({
    url: undefined,
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(data, null);
  assert.equal(called, false);
});

test("does not block beyond the 10s timeout budget", async () => {
  // A fetch that resolves quickly with 200 should return well under 10s; we
  // assert the call completes promptly (sanity that there's no extra wait).
  const start = Date.now();
  await fetchExternalData({ url: "https://aa/x", fetchImpl: mockFetch(200, sample) });
  assert.ok(Date.now() - start < 1000, "fast upstream should return quickly");
});

test("empty external data → empty prompt section", () => {
  assert.equal(formatExternalDataForPrompt({ birdeye: [], perplexity: [] }), "");
  assert.equal(formatExternalDataForPrompt(null), "");
});
