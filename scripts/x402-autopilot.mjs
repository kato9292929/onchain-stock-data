#!/usr/bin/env node
/**
 * AA autopilot for the catalyst per-call sweep — default OFF, armed once by a
 * human, then self-driving.
 *
 * The point: an agent should run the whole thing itself, but real funds must
 * only ever move after a human explicitly arms it, and a redeploy must never
 * replay a money step. So the progress lives in Upstash as a state machine:
 *
 *   unstarted → run0_ok → smoke_ok → live
 *     unstarted : nothing has run
 *     run0_ok   : dry-run probe passed (no spend)
 *     smoke_ok  : exactly ONE mainnet tx has settled (the smoke)
 *     live      : weekly full-roster sweeps, at most once per SWEEP interval
 *
 * State + a per-step lock live in Upstash, so re-invoking (a redeploy, a
 * scheduler firing twice) never repeats a charge. Nothing runs unless
 * CATALYST_AUTOPILOT=true — that flag is the single human arm. After it's set,
 * the agent advances run0 → smoke → live and then drives the weekly sweep on
 * its own; a scheduler (Railway cron, GH schedule, …) just needs to invoke this
 * script periodically — it is safe at any cadence.
 *
 * Catalyst only for now (EDINET autopilot comes after). Env:
 *   CATALYST_AUTOPILOT           "true" to arm (default off → no-op, no spend)
 *   UPSTASH_REDIS_REST_URL/TOKEN state store (required when armed)
 *   AA_SOLANA_SECRET_KEY         funded buyer wallet (used only for smoke/live)
 *   WEEKLY_SPEND_CAP_UNITS       hard cap per run, inherited by the buyer
 *   AUTOPILOT_SWEEP_INTERVAL_MS  min gap between full sweeps (default 6.5 days)
 */
import { execFileSync } from "node:child_process";

const NS = "catalyst";
const ARMED = /^(1|true)$/i.test(process.env.CATALYST_AUTOPILOT ?? "");
const STATE_KEY = `x402:autopilot:${NS}:state`;
const LOCK_KEY = `x402:autopilot:${NS}:lock`;
const LAST_SWEEP_KEY = `x402:autopilot:${NS}:last_sweep_at`;
const SWEEP_INTERVAL_MS = Number(process.env.AUTOPILOT_SWEEP_INTERVAL_MS ?? 6.5 * 24 * 3600 * 1000);

async function upstash(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN not set (autopilot needs the state store)");
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([command]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}: ${await res.text()}`);
  const [reply] = await res.json();
  if (reply && reply.error) throw new Error(`upstash: ${reply.error}`);
  return reply?.result ?? null;
}

const getState = async () => (await upstash(["GET", STATE_KEY])) ?? "unstarted";
const setState = (s) => upstash(["SET", STATE_KEY, s]);
/** Atomic lock: returns true if acquired. */
const acquire = async (ttlSec) => (await upstash(["SET", LOCK_KEY, String(Date.now()), "NX", "EX", String(ttlSec)])) === "OK";
const release = () => upstash(["DEL", LOCK_KEY]);

/** Spawn the existing buyer with env overrides; throws on non-zero exit. */
function runBuyer(overrides) {
  execFileSync("node", ["scripts/x402-weekly-buyer.mjs"], {
    stdio: "inherit",
    env: { ...process.env, SPEND_NAMESPACE: NS, ENDPOINT_TEMPLATE: "/api/catalyst/{ticker}", ...overrides },
  });
}

async function main() {
  if (!ARMED) {
    console.log("[autopilot] OFF — no spend. Arm with CATALYST_AUTOPILOT=true once the wallet is funded.");
    return;
  }
  let state = await getState();
  console.log(`[autopilot:${NS}] state=${state}`);

  if (state === "unstarted") {
    // run0 — dry-run probe, no signing, no spend.
    runBuyer({ DRY_RUN: "1", MAX_TICKERS: "3" });
    await setState("run0_ok");
    state = "run0_ok";
    console.log("[autopilot] → run0_ok (probe passed, no spend)");
  }

  if (state === "run0_ok") {
    // smoke — exactly ONE real mainnet payment, guarded by a lock so a redeploy
    // can't replay it.
    if (!(await acquire(600))) {
      console.log("[autopilot] smoke locked (another run in flight) — exit");
      return;
    }
    try {
      runBuyer({ MAX_TICKERS: "1" });
      await setState("smoke_ok");
      state = "smoke_ok";
      console.log("[autopilot] → smoke_ok (1 mainnet tx settled)");
    } finally {
      await release();
    }
  }

  if (state === "smoke_ok") {
    await setState("live");
    state = "live";
    console.log("[autopilot] → live (weekly sweeps enabled)");
  }

  if (state === "live") {
    const last = Number((await upstash(["GET", LAST_SWEEP_KEY])) ?? 0);
    if (Date.now() - last < SWEEP_INTERVAL_MS) {
      const dueIn = Math.ceil((SWEEP_INTERVAL_MS - (Date.now() - last)) / 3600000);
      console.log(`[autopilot] weekly sweep not due yet (~${dueIn}h) — exit`);
      return;
    }
    if (!(await acquire(3600))) {
      console.log("[autopilot] sweep locked (another run in flight) — exit");
      return;
    }
    try {
      runBuyer({}); // full roster, capped by WEEKLY_SPEND_CAP_UNITS
      await upstash(["SET", LAST_SWEEP_KEY, String(Date.now())]);
      console.log("[autopilot] weekly sweep done");
    } finally {
      await release();
    }
  }
}

main().catch((err) => {
  console.error("[autopilot] fatal:", err?.stack ?? err);
  process.exit(1);
});
