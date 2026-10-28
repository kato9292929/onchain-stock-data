import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runOutcome } from "../evaluate-catalysts.mjs";
import { isFatalRunError } from "../lib/run-errors.mjs";

test("the 2026-10-25 failure is fatal: a bad key repeats for every catalyst", () => {
  assert.ok(isFatalRunError(Object.assign(new Error("invalid x-api-key"), { status: 401 })));
  // Some wrappers drop the status; the message alone must still stop the run.
  assert.ok(isFatalRunError(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')));
  assert.ok(isFatalRunError(new Error("400 Your credit balance is too low to access the Anthropic API")));
  assert.ok(!isFatalRunError(new Error("could not parse verdict JSON: no JSON object")));
  assert.ok(!isFatalRunError(new Error("Request timed out.")));
});

test("an aborted run is a failed run, even if something was judged first", () => {
  assert.equal(runOutcome({ attempted: 3, judged: 2, aborted: "401" }).ok, false);
  assert.equal(runOutcome({ attempted: 1, judged: 0, aborted: "401" }).ok, false);
});

test("attempting judgements and landing none is a failure", () => {
  const o = runOutcome({ attempted: 11, judged: 0, aborted: null });
  assert.equal(o.ok, false);
  assert.match(o.message, /all 11/);
});

test("nothing due is not a failure, and one bad JSON among many is not either", () => {
  assert.equal(runOutcome({ attempted: 0, judged: 0, aborted: null }).ok, true);
  assert.equal(runOutcome({ attempted: 5, judged: 4, aborted: null }).ok, true);
});

test("the research script still exposes the same classifier", async () => {
  const mod = await import("../research-ir-fair.mjs");
  assert.equal(mod.isFatalRunError, isFatalRunError);
});

test("no workflow that holds the Anthropic key runs on a schedule", () => {
  // Chat operation since 2026-10-28: selection and judging happen in chat and
  // are imported with scripts/import-from-chat.mjs. A schedule here is a cost
  // action and needs the AGENTS.md checklist and the owner's approval.
  for (const f of ["evaluate-catalysts", "update-portfolio", "update-jp-portfolio", "research-ir-fair"]) {
    const y = readFileSync(`.github/workflows/${f}.yml`, "utf8");
    const live = y.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    assert.ok(!live.some((l) => /^\s*schedule:/.test(l)), `${f} has a live schedule`);
    assert.ok(live.some((l) => /workflow_dispatch/.test(l)), `${f} lost workflow_dispatch`);
  }
});

test("a 401 stops the run at the first catalyst and exits non-zero", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, cp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const REPO = process.cwd();
  const today = new Date().toISOString().slice(0, 10);
  const ago = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const dir = await mkdtemp(path.join(tmpdir(), "osd-failfast-"));
  await mkdir(path.join(dir, "data"), { recursive: true });
  await cp(path.join(REPO, "scripts", "evaluate-catalysts.mjs"), path.join(dir, "scripts", "evaluate-catalysts.mjs"));
  await cp(path.join(REPO, "scripts", "lib"), path.join(dir, "scripts", "lib"), { recursive: true });
  await writeFile(path.join(dir, "data", "portfolio-evaluations.json"), JSON.stringify({ evaluations: [] }));
  await writeFile(path.join(dir, "data", "portfolio-history.json"), JSON.stringify({ current: null, history: [] }));
  const ext = (id) => ({
    catalyst_id: id, ticker: "NVDA", catalyst_description: "x", target_date: ago(20),
    status: "pending", judgement_date: null, evidence_urls: [], reasoning: null,
  });
  await writeFile(path.join(dir, "data", "external-catalysts.json"), JSON.stringify([ext("ext_a"), ext("ext_b"), ext("ext_c")]));

  const stubDir = path.join(dir, "node_modules", "@anthropic-ai", "sdk");
  await mkdir(stubDir, { recursive: true });
  await writeFile(path.join(stubDir, "package.json"), JSON.stringify({ name: "@anthropic-ai/sdk", type: "module", main: "index.mjs" }));
  await writeFile(
    path.join(stubDir, "index.mjs"),
    `import { appendFileSync } from "node:fs";
     export default class Anthropic {
       constructor() { this.messages = { create: async () => {
         appendFileSync("calls.log", "x");
         throw Object.assign(new Error("401 invalid x-api-key"), { status: 401 });
       } }; }
     }\n`,
  );

  let code = 0;
  let stderr = "";
  try {
    await promisify(execFile)("node", ["scripts/evaluate-catalysts.mjs"], {
      cwd: dir,
      env: { ...process.env, ANTHROPIC_API_KEY: "bad" },
    });
  } catch (e) {
    code = e.code;
    stderr = e.stderr;
  }
  assert.equal(code, 1, "a run where the key is rejected must not go green");
  assert.match(stderr, /run aborted after 0\/1 judged/);
  assert.equal((await readFile(path.join(dir, "calls.log"), "utf8")).length, 1, "stopped after the first call");
});
