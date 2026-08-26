/**
 * Cost guard (work-order T11): the signal-serving path must NEVER call an LLM.
 *
 * signal_get (MCP) and /api/testnet/signal serve pre-generated, committed
 * signals from data/signals.json. If a future edit wires live generation into
 * this path, testnet payments would silently trigger Anthropic API spend — the
 * exact class of cost accident AGENTS.md forbids. This test fails the build if
 * any file on the signal path imports the Anthropic SDK or references a model
 * call, so the guarantee is enforced mechanically, not by reviewer memory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Every source file that participates in serving a signal response.
const SIGNAL_PATH_FILES = [
  "app/api/mcp/route.ts",
  "app/api/testnet/signal/route.ts",
  "lib/signals.ts",
];

// Markers that indicate a live model call slipped into the path.
const FORBIDDEN = [
  "@anthropic-ai/sdk",
  "messages.create",
  "ANTHROPIC_API_KEY",
  "new Anthropic",
];

for (const rel of SIGNAL_PATH_FILES) {
  test(`no LLM call on signal path: ${rel}`, () => {
    const src = readFileSync(path.join(root, rel), "utf8");
    for (const needle of FORBIDDEN) {
      assert.ok(
        !src.includes(needle),
        `${rel} must not contain "${needle}" — the signal path serves committed data only (no live generation).`,
      );
    }
  });
}
