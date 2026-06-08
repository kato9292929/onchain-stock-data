/**
 * Phase 1 wrapper tests — run with: npm test.
 * Mock the upstream fetch and assert transform / error handling. The x402
 * paywall firing on unpaid requests is asserted separately (paywall.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchBirdeyeOhlcv,
  fetchPerplexityResearch,
  parseResearchEvents,
  buildPerplexityPrompt,
} from "../../lib/wrappers.ts";

function mockFetch(status, jsonBody) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
  });
}
function abortingFetch() {
  return async (_url, opts) =>
    new Promise((_resolve, reject) => {
      const err = new Error("aborted");
      err.name = "AbortError";
      if (opts?.signal) opts.signal.addEventListener("abort", () => reject(err));
      // Also reject immediately to simulate timeout abort.
      reject(err);
    });
}

// ── Birdeye happy path ──────────────────────────────────────────────────
test("birdeye: maps upstream items to OHLCV candles", async () => {
  const upstream = {
    data: {
      items: [
        { unixTime: 1717000000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 },
        { unixTime: 1717086400, o: 1.5, h: 2.2, l: 1.4, c: 2.0, v: 2000 },
      ],
    },
  };
  const SECRET = "SECRET_BIRDEYE_KEY_123";
  const out = await fetchBirdeyeOhlcv(
    { address: "So111", type: "1D", limit: 30 },
    { fetchImpl: mockFetch(200, upstream), apiKey: SECRET },
  );
  assert.equal(out.ok, true);
  assert.equal(out.value.address, "So111");
  assert.equal(out.value.candles.length, 2);
  assert.deepEqual(out.value.candles[0], { ts: 1717000000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 });
  assert.ok(out.value.fetched_at);
  // API key must never leak into the returned payload.
  assert.equal(JSON.stringify(out.value).includes(SECRET), false);
});

test("birdeye: missing api key → 503", async () => {
  const out = await fetchBirdeyeOhlcv({ address: "So111" }, { fetchImpl: mockFetch(200, {}), apiKey: "" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 503);
  assert.equal(out.err.kind, "missing_api_key");
});

test("birdeye: missing address → 400", async () => {
  const out = await fetchBirdeyeOhlcv({}, { fetchImpl: mockFetch(200, {}), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 400);
});

test("birdeye: upstream 4xx propagates status", async () => {
  const out = await fetchBirdeyeOhlcv({ address: "x" }, { fetchImpl: mockFetch(429, {}), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 429);
  assert.equal(out.err.kind, "upstream_error");
});

test("birdeye: upstream 5xx propagates status", async () => {
  const out = await fetchBirdeyeOhlcv({ address: "x" }, { fetchImpl: mockFetch(503, {}), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 503);
});

test("birdeye: timeout → 504", async () => {
  const out = await fetchBirdeyeOhlcv({ address: "x" }, { fetchImpl: abortingFetch(), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 504);
  assert.equal(out.err.kind, "timeout");
});

// ── Perplexity ──────────────────────────────────────────────────────────
test("perplexity: prompt is the fixed template", () => {
  assert.equal(
    buildPerplexityPrompt("NVDA", 24),
    "What are the top 3 news events for NVDA in the past 24 hours? For each, return: event title, ISO date, source URL, and a possible catalyst formulation as 'target_date + condition'. Return as JSON.",
  );
});

test("perplexity: parses fenced JSON events + keeps citations", async () => {
  const content = "```json\n" + JSON.stringify({
    events: [
      { title: "Earnings beat", date: "2026-08-28", source_url: "https://x.com/a", catalyst_suggestion: "2026-08-28 + AI rev > $4.5B" },
    ],
  }) + "\n```";
  const upstream = { choices: [{ message: { content } }], citations: ["https://src/1"] };
  const out = await fetchPerplexityResearch(
    { ticker: "nvda", lookback_hours: 24 },
    { fetchImpl: mockFetch(200, upstream), apiKey: "k" },
  );
  assert.equal(out.ok, true);
  assert.equal(out.value.ticker, "NVDA");
  assert.equal(out.value.events.length, 1);
  assert.equal(out.value.events[0].title, "Earnings beat");
  assert.deepEqual(out.value.citations, ["https://src/1"]);
});

test("perplexity: missing api key → 503", async () => {
  const out = await fetchPerplexityResearch({ ticker: "NVDA" }, { fetchImpl: mockFetch(200, {}), apiKey: "" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 503);
});

test("perplexity: missing ticker → 400", async () => {
  const out = await fetchPerplexityResearch({}, { fetchImpl: mockFetch(200, {}), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 400);
});

test("perplexity: upstream 5xx propagates", async () => {
  const out = await fetchPerplexityResearch({ ticker: "NVDA" }, { fetchImpl: mockFetch(500, {}), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 500);
});

test("perplexity: timeout → 504", async () => {
  const out = await fetchPerplexityResearch({ ticker: "NVDA" }, { fetchImpl: abortingFetch(), apiKey: "k" });
  assert.equal(out.ok, false);
  assert.equal(out.err.status, 504);
});

test("parseResearchEvents: malformed content → []", () => {
  assert.deepEqual(parseResearchEvents("not json at all"), []);
});
