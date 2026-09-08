# x402 per-call on Solana — AA weekly buyer

Goal: an agent (AA) pays `/api/catalyst/{ticker}` for the whole roster (~197)
each week in USDC on **Solana mainnet**, so the payments are provable as
on-chain txs on Solscan.

## What's wired

- **Server** — `/api/catalyst/{ticker}` is **Solana-only, exact-svm**, priced at
  **100 USDC base units = 0.0001 USDC** (`maxAmountRequired="100"`). It settles
  in USDC-SPL (mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) via
  the PayAI facilitator that already verifies Solana. The Base (EVM) leg is
  dropped for this endpoint so the buyer can only settle on Solana.
- **Buyer** — `scripts/x402-weekly-buyer.mjs` uses the official x402 client SDK
  (`@x402/core/client` + `@x402/svm/exact/client`). Per ticker: GET → 402 → sign
  a USDC transfer → retry with `X-PAYMENT` → 200 + settle receipt (tx sig). It
  enforces a hard **spend cap** and writes a proof log to `proof/`.
- **Workflow** — `.github/workflows/x402-weekly-buyer.yml`, `workflow_dispatch`
  only. The weekly `schedule:` is **commented out** until the checklist below is
  done and the owner approves.

## Cost (real, mainnet)

- Per weekly run: `197 × 100 units = 19,700 units = 0.0197 USDC` (~$0.02) +
  negligible SOL gas. Default cap `WEEKLY_SPEND_CAP_UNITS=30000` (0.03 USDC/run).
- Fund the AA wallet with a small USDC balance (e.g. 1 USDC = ~50 weeks) and a
  little SOL for gas.

## Env / secrets

Set as GitHub Actions secrets/vars (never commit keys):

| name | where | meaning |
|---|---|---|
| `AA_SOLANA_SECRET_KEY` | secret | funded buyer key — JSON array (`solana-keygen`) or base58 (Phantom) |
| `WEEKLY_SPEND_CAP_UNITS` | var | hard cap in base units (default 30000) |
| `SOLANA_RECEIVE_ADDRESS` | server env (Vercel) | your Solana mainnet receive wallet (`payTo`) |

Devnet-preview-only server env (for the smoke): `X402_SOLANA_NETWORK` =
devnet CAIP-2, `SOLANA_USDC_MINT` = devnet USDC
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, `SOLANA_RECEIVE_ADDRESS` = a
devnet wallet.

## Runbook (don't linger on testnet)

1. **Dry-run** (no funds): Actions → *x402 weekly buyer* → `mode: dry-run`. Confirms
   every endpoint returns a 402 whose challenge is Solana + `maxAmountRequired="100"`.
2. **Devnet smoke, once**: deploy a preview with the devnet server env above; fund a
   devnet AA wallet; run `mode: devnet-smoke`, `only_ticker: <one>`. Expect a single
   `402 → sign → 200` with a devnet Solscan tx. This proves the wiring end-to-end.
3. **Mainnet, one manual run**: `mode: mainnet-weekly`, `max_tickers: 5` first to
   measure real cost, then the full roster. Check the committed `proof/` log and the
   Solscan links.
4. **Enable weekly** (only after owner approval): uncomment the `schedule:` block in
   the workflow.

## Autopilot (arm once, then self-driving)

`scripts/x402-autopilot.mjs` (`npm run x402:autopilot`) lets the agent run the
whole catalyst sweep itself, with the only human step being a one-time arm.

- **Default OFF.** Nothing runs (no spend) unless `CATALYST_AUTOPILOT=true`.
- **Upstash state machine** `unstarted → run0_ok → smoke_ok → live`, so a
  redeploy or a scheduler firing twice never replays a money step:
  - `run0` — dry-run probe (no spend) → `run0_ok`
  - `smoke` — exactly ONE mainnet tx, lock-guarded → `smoke_ok`
  - `live` — full-roster weekly sweep, at most once per `AUTOPILOT_SWEEP_INTERVAL_MS`
    (default 6.5 days), lock-guarded
- Invoke it periodically from any scheduler (Railway cron, GH schedule) — it is
  safe at any cadence; it only acts when a step is due.

**The one human action:** confirm the buyer wallet (shared Circle wallet) holds
USDC + a little SOL and `SOLANA_RPC_URL` is set, then set `CATALYST_AUTOPILOT=true`
once. From there the agent does run0 → 1 mainnet smoke → weekly sweeps on its own.
Real funds move only after the arm.

Env: `CATALYST_AUTOPILOT`, `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `AA_SOLANA_SECRET_KEY`,
`WEEKLY_SPEND_CAP_UNITS`, `AUTOPILOT_SWEEP_INTERVAL_MS`. (EDINET autopilot comes
after catalyst is proven live.)

## Proof output

Each non-dry run writes `proof/x402-weekly-<date>.json`:

```json
{ "summary": { "ok": 197, "spent_units": 19700, "spent_usdc": 0.0197,
  "txs": [ { "ticker": "7212", "tx": "…", "solscan": "https://solscan.io/tx/…" } ] } }
```

and the workflow commits it, so the on-chain record of "paid ~197 per-call every
week" is in git and clickable on Solscan.

## EDINET endpoint (same rail, separate sweep)

`/api/edinet/{code}` is a second paid endpoint on the **same** Solana exact-svm
rail (`withSolanaUsdcMicroPaywall`, 100 units, network/mint/==100 safety valve).
`code` is a 4-digit TSE ticker (→ 5-digit securities code) or a securities code;
it returns that company's recent EDINET disclosures (metadata) from the official
EDINET API v2, filtered by securities code. Terms compliance is baked in: every
payload carries `source: "出典：金融庁 EDINET"` and `processed_by`, data is fetched
only via the v2 API, and each date's document list is cached weekly. Requires the
`EDINET_API_KEY` deploy secret (Vercel). Free descriptor at `/api/edinet`.

The buyer is reused for the sweep via `.github/workflows/x402-edinet-sweep.yml`
with `ENDPOINT_TEMPLATE=/api/edinet/{ticker}` and `SPEND_NAMESPACE=edinet` — a
**separate job, separate spend cap** (`EDINET_WEEKLY_SPEND_CAP_UNITS`) and a
separate proof file (`proof/x402-edinet-<date>.json`). Same gated runbook
(dry-run → devnet-smoke → one measured mainnet run → approve → uncomment
`schedule:`).
