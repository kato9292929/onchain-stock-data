#!/usr/bin/env node
/**
 * AA weekly buyer — pays the catalyst per-call endpoint for the whole roster on
 * Solana, so every settlement lands as an on-chain USDC-SPL tx verifiable on
 * Solscan. Uses the official x402 client SDK (exact-svm), so the payment
 * payload is built and signed the same way the server verifies it.
 *
 * Flow per ticker: GET /api/catalyst/{ticker} → 402 challenge → sign a USDC
 * transfer into the payload → retry with X-PAYMENT → 200 + settle receipt (tx
 * signature). Network is taken from the 402 challenge, so the SAME script runs
 * the devnet wiring smoke (§4) and the mainnet weekly job — only the endpoint
 * (OSD_BASE_URL) and the funded wallet differ.
 *
 * SAFETY:
 *  - Real funds. Never runs unless AA_SOLANA_SECRET_KEY is set (a funded wallet).
 *  - Hard spend cap (WEEKLY_SPEND_CAP_UNITS, base units). The loop stops before
 *    it would exceed the cap and reports. 197 × 100 = 19,700 units = 0.0197 USDC.
 *  - DRY_RUN=1 probes the 402 challenge only (no signing, no spend) — use it to
 *    validate the roster + endpoint before funding anything.
 *
 * Env:
 *   AA_SOLANA_SECRET_KEY   funded buyer key — JSON array (solana-keygen) or base58 (Phantom)
 *   OSD_BASE_URL           default https://osd.x402jp.com (point at a devnet preview for the smoke)
 *   PRICE_UNITS            per-call USDC base units (default 1000 = 0.001 USDC) — must match the server
 *   WEEKLY_SPEND_CAP_UNITS hard cap in base units (default 500000 = 0.5 USDC)
 *   MAX_TICKERS            cap the roster size (default 0 = all)
 *   ONLY_TICKER            pay a single ticker (the devnet smoke)
 *   DELAY_MS               pause between calls (default 400) to be gentle on RPC/facilitator
 *   DRY_RUN                "1"/"true" → probe 402 only, never sign or spend
 *   PROOF_DIR              where to write the run log (default ./proof)
 */
import fs from "node:fs";
import path from "node:path";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Encoder,
} from "@solana/kit";

const BASE_URL = (process.env.OSD_BASE_URL ?? "https://osd.x402jp.com").replace(/\/$/, "");
// Endpoint swept, with {ticker} substituted per roster entry. Defaults to the
// catalyst endpoint; the EDINET sweep passes /api/edinet/{ticker}.
const ENDPOINT_TEMPLATE = process.env.ENDPOINT_TEMPLATE ?? "/api/catalyst/{ticker}";
// Spend namespace — keeps each sweep's proof log (and, via the workflow, its
// spend cap) separate. "catalyst" and "edinet" never share a budget or a file.
const SPEND_NAMESPACE = (process.env.SPEND_NAMESPACE ?? "catalyst").replace(/[^a-z0-9_-]/gi, "");
const PRICE_UNITS = Number(process.env.PRICE_UNITS ?? 1000);
const CAP_UNITS = Number(process.env.WEEKLY_SPEND_CAP_UNITS ?? 500000);
const MAX_TICKERS = Number(process.env.MAX_TICKERS ?? 0);
const ONLY_TICKER = (process.env.ONLY_TICKER ?? "").trim().toUpperCase();
const DELAY_MS = Number(process.env.DELAY_MS ?? 400);
const DRY_RUN = /^(1|true)$/i.test(process.env.DRY_RUN ?? "");
const PROOF_DIR = process.env.PROOF_DIR ?? path.join(process.cwd(), "proof");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Roster = every ticker in the IR-Fair catalyst file (deduped, in file order). */
function loadRoster() {
  const file = path.join(process.cwd(), "data", "ir-fair-2026-catalysts.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const seen = new Set();
  const out = [];
  for (const c of json.catalysts ?? []) {
    const t = String(c.ticker ?? "").trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** Build a @solana/kit signer from AA_SOLANA_SECRET_KEY (JSON array or base58). */
async function loadSigner() {
  const raw = process.env.AA_SOLANA_SECRET_KEY;
  if (!raw || !raw.trim()) throw new Error("AA_SOLANA_SECRET_KEY not set (a funded buyer wallet)");
  const s = raw.trim();
  const bytes = s.startsWith("[")
    ? Uint8Array.from(JSON.parse(s))
    : new Uint8Array(getBase58Encoder().encode(s));
  if (bytes.length === 64) return createKeyPairSignerFromBytes(bytes);
  if (bytes.length === 32) return createKeyPairSignerFromPrivateKeyBytes(bytes);
  throw new Error(`unexpected secret key length ${bytes.length} (want 32 or 64 bytes)`);
}

/** Solscan URL for a tx signature, cluster inferred from the settlement network. */
function solscan(sig, network) {
  const mainnet = String(network ?? "").includes("5eykt4"); // mainnet-beta genesis
  return mainnet
    ? `https://solscan.io/tx/${sig}`
    : `https://solscan.io/tx/${sig}?cluster=devnet`;
}

async function main() {
  const roster0 = ONLY_TICKER ? [ONLY_TICKER] : loadRoster();
  const roster = MAX_TICKERS > 0 ? roster0.slice(0, MAX_TICKERS) : roster0;

  let http = null;
  if (!DRY_RUN) {
    const signer = await loadSigner();
    const client = new x402Client();
    registerExactSvmScheme(client, { signer });
    http = new x402HTTPClient(client);
    console.log(`[buyer:${SPEND_NAMESPACE}] wallet ${signer.address} | ${ENDPOINT_TEMPLATE} | ${roster.length} tickers | price ${PRICE_UNITS} units | cap ${CAP_UNITS} units`);
  } else {
    console.log(`[buyer:${SPEND_NAMESPACE}] DRY_RUN — probing 402 for ${roster.length} × ${ENDPOINT_TEMPLATE} (no signing, no spend)`);
  }

  const results = [];
  let spent = 0;
  let ok = 0, failed = 0, skipped = 0;

  for (const ticker of roster) {
    if (!DRY_RUN && spent + PRICE_UNITS > CAP_UNITS) {
      console.log(`[buyer] spend cap reached (${spent}/${CAP_UNITS} units) — stopping before ${ticker}`);
      skipped = roster.length - results.length;
      break;
    }
    const url = `${BASE_URL}${ENDPOINT_TEMPLATE.replace("{ticker}", encodeURIComponent(ticker))}`;
    try {
      const r1 = await fetch(url, { method: "GET" });
      if (r1.status !== 402) {
        failed++;
        results.push({ ticker, ok: false, reason: `expected 402, got ${r1.status}` });
        console.log(`  ✗ ${ticker} — expected 402, got ${r1.status}`);
        await sleep(DELAY_MS);
        continue;
      }
      if (DRY_RUN) {
        ok++;
        results.push({ ticker, ok: true, dry_run: true });
        console.log(`  · ${ticker} — 402 challenge OK (dry-run)`);
        await sleep(DELAY_MS);
        continue;
      }

      const pr = http.getPaymentRequiredResponse((n) => r1.headers.get(n));
      const payload = await http.createPaymentPayload(pr);
      const payHeaders = http.encodePaymentSignatureHeader(payload);
      const r2 = await fetch(url, { method: "GET", headers: payHeaders });
      const settle = http.getPaymentSettleResponse((n) => r2.headers.get(n));

      if (r2.status === 200 && settle?.success) {
        spent += PRICE_UNITS;
        ok++;
        const tx = settle.transaction ?? settle.txHash ?? "";
        const link = tx ? solscan(tx, settle.network) : "";
        results.push({ ticker, ok: true, tx, solscan: link, network: settle.network });
        console.log(`  ✓ ${ticker} — ${tx} ${link}`);
      } else {
        failed++;
        results.push({ ticker, ok: false, reason: `status ${r2.status}, settle ${JSON.stringify(settle)}` });
        console.log(`  ✗ ${ticker} — status ${r2.status} settle=${JSON.stringify(settle)}`);
      }
    } catch (err) {
      failed++;
      results.push({ ticker, ok: false, reason: String(err?.message ?? err) });
      console.log(`  ✗ ${ticker} — ${err?.message ?? err}`);
    }
    await sleep(DELAY_MS);
  }

  const summary = {
    at: new Date().toISOString(),
    namespace: SPEND_NAMESPACE,
    endpoint_template: ENDPOINT_TEMPLATE,
    base_url: BASE_URL,
    dry_run: DRY_RUN,
    tickers: roster.length,
    ok, failed, skipped,
    spent_units: spent,
    spent_usdc: spent / 1e6,
    cap_units: CAP_UNITS,
    txs: results.filter((r) => r.ok && r.tx).map((r) => ({ ticker: r.ticker, tx: r.tx, solscan: r.solscan })),
  };

  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const stamp = summary.at.slice(0, 10);
  const outFile = path.join(PROOF_DIR, `x402-${SPEND_NAMESPACE}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2) + "\n");

  console.log(
    `\n[buyer] ${DRY_RUN ? "DRY-RUN " : ""}${ok}/${roster.length} paid, ${spent} units (${(spent / 1e6).toFixed(6)} USDC), cap ${CAP_UNITS}, failed ${failed}, skipped ${skipped}`,
  );
  console.log(`[buyer] proof written to ${outFile}`);

  // Non-zero exit if nothing settled on a real run, so CI surfaces a wiring break.
  if (!DRY_RUN && ok === 0) process.exit(1);
}

main().catch((err) => {
  console.error("[buyer] fatal:", err?.stack ?? err);
  process.exit(1);
});
