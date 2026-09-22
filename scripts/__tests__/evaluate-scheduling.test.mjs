/**
 * Two scheduling properties of scripts/evaluate-catalysts.mjs, both exercised
 * by running the real script in a temp repo with a stubbed @anthropic-ai/sdk.
 *
 * 1. US holdings are auto-registered as pending evaluations, but only from
 *    US_AUTOREGISTER_FROM onward. The US flow was not self-bootstrapping, so
 *    the scorecard froze in July 2026; registering every past week at once
 *    would dump ~55 already-due catalysts into the queue in one run.
 * 2. The per-run cap is shared by the US / external / JP lanes, and is spent
 *    fairly across them. Merging the lanes and judging the globally oldest
 *    first let one lane's backlog take every slot for weeks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const today = new Date().toISOString().slice(0, 10);

/** A temp repo holding the real script plus whatever fixtures a test writes. */
async function makeRepo(files) {
  const dir = await mkdtemp(path.join(tmpdir(), "osd-sched-"));
  await mkdir(path.join(dir, "data"), { recursive: true });
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await cp(
    path.join(REPO, "scripts", "evaluate-catalysts.mjs"),
    path.join(dir, "scripts", "evaluate-catalysts.mjs"),
  );
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(dir, "data", name), JSON.stringify(value));
  }
  // Stub the SDK so a judged entry needs no key, no network and no spend.
  const stubDir = path.join(dir, "node_modules", "@anthropic-ai", "sdk");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    path.join(stubDir, "package.json"),
    JSON.stringify({
      name: "@anthropic-ai/sdk",
      version: "0.0.0",
      type: "module",
      main: "index.mjs",
    }),
  );
  await writeFile(
    path.join(stubDir, "index.mjs"),
    `export default class Anthropic {
       constructor() { this.messages = { create: async () => ({
         stop_reason: "end_turn",
         content: [{ type: "text", text: '\\n\\\`\\\`\\\`json\\n{"status":"hit","evidence_url":null,"reasoning":"stub verdict"}\\n\\\`\\\`\\\`' }],
       }) }; }
     }\n`,
  );
  return dir;
}

const run = (dir, env = {}) =>
  execFileP("node", ["scripts/evaluate-catalysts.mjs"], {
    cwd: dir,
    env: { ...process.env, ANTHROPIC_API_KEY: "test-key", ...env },
  });

const emptyEvals = { source: "t", note: "t", updated_at: today, evaluations: [] };
const holding = (ticker, target) => ({
  ticker,
  company_name: `${ticker} Inc`,
  weight: 10,
  thesis: `${ticker} の想定カタリスト`,
  ...(target ? { target_date: target } : {}),
});

test("US rows are auto-registered from the cutoff week only", async () => {
  const thisWeek = "2026-09-21";
  const oldWeek = "2026-06-15";
  const dir = await makeRepo({
    "portfolio-evaluations.json": emptyEvals,
    "portfolio-history.json": {
      current: {
        week_of: thisWeek,
        holdings: [
          holding("MSFT", addDays(today, 35)),
          holding("JPM", addDays(today, 22)),
          // No target_date — nothing to judge against, must be skipped.
          holding("NOPE", null),
        ],
      },
      history: [
        { week_of: oldWeek, holdings: [holding("OLD", addDays(today, -60))] },
      ],
    },
  });

  await run(dir, { US_AUTOREGISTER_FROM: thisWeek });

  const out = JSON.parse(
    await readFile(path.join(dir, "data", "portfolio-evaluations.json"), "utf8"),
  );
  const tickers = out.evaluations.map((e) => e.ticker).sort();
  assert.deepEqual(tickers, ["JPM", "MSFT"], "only dated holdings from the cutoff week");

  const msft = out.evaluations.find((e) => e.ticker === "MSFT");
  assert.equal(msft.status, "pending");
  assert.equal(msft.week_of, thisWeek);
  assert.equal(msft.evaluated_at, null, "future catalysts are not judged, so nothing is spent");
  assert.equal(
    msft.success_condition,
    "MSFT の想定カタリスト",
    "the free-text thesis is carried over verbatim",
  );
});

test("an older week is left alone even when its catalyst is long overdue", async () => {
  // The guard that keeps ~55 due catalysts from entering the queue at once.
  const dir = await makeRepo({
    "portfolio-evaluations.json": emptyEvals,
    "portfolio-history.json": {
      current: null,
      history: [
        { week_of: "2026-06-29", holdings: [holding("VKTX", addDays(today, -60))] },
      ],
    },
  });

  await run(dir, { US_AUTOREGISTER_FROM: "2026-09-21" });

  const out = JSON.parse(
    await readFile(path.join(dir, "data", "portfolio-evaluations.json"), "utf8"),
  );
  assert.equal(out.evaluations.length, 0, "pre-cutoff weeks stay out of the queue");
});

test("a US backlog cannot starve the JP lane within one run", async () => {
  // Six US catalysts, all older than the single JP one. Under the previous
  // merge-and-sort, a cap of 4 went entirely to US and JP waited.
  const usRows = Array.from({ length: 6 }, (_, i) => ({
    week_of: "2026-07-06",
    ticker: `US${i}`,
    catalyst_target_date: addDays(today, -60 + i),
    success_condition: `US${i} の条件`,
    status: "pending",
    evaluated_at: null,
    evidence_url: null,
    reasoning: null,
  }));

  const dir = await makeRepo({
    "portfolio-evaluations.json": { ...emptyEvals, evaluations: usRows },
    "portfolio-history.json": { current: null, history: [] },
    // Auto-registered by the JP block, then immediately due.
    "jp-portfolio-history.json": {
      current: {
        week_of: "2026-08-24",
        holdings: [holding("6857", addDays(today, -10))],
      },
      history: [],
    },
  });

  await run(dir, { EVALUATE_MAX_PER_RUN: "4", US_AUTOREGISTER_FROM: "2999-01-01" });

  const us = JSON.parse(
    await readFile(path.join(dir, "data", "portfolio-evaluations.json"), "utf8"),
  );
  const jp = JSON.parse(
    await readFile(path.join(dir, "data", "jp-portfolio-evaluations.json"), "utf8"),
  );

  const usJudged = us.evaluations.filter((e) => e.status !== "pending");
  const jpJudged = jp.evaluations.filter((e) => e.status !== "pending");

  assert.equal(jpJudged.length, 1, "the JP lane gets a slot despite the older US backlog");
  assert.equal(usJudged.length, 3, "US takes the rest of the cap, oldest first");
  assert.equal(usJudged.length + jpJudged.length, 4, "the per-run cap is unchanged");
  assert.deepEqual(
    usJudged.map((e) => e.ticker).sort(),
    ["US0", "US1", "US2"],
    "within a lane the oldest still go first",
  );
});
