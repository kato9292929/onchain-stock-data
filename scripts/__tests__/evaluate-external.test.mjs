/**
 * Integration test: the daily evaluator picks up data/external-catalysts.json.
 *
 * Runs the real scripts/evaluate-catalysts.mjs in a temp working dir with a
 * fixture that has one DUE external catalyst and one NOT-YET-DUE one, and a
 * stubbed @anthropic-ai/sdk (so no network / API key needed). Asserts only the
 * due entry is judged and written back with judgement_date + evidence_urls.
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

test("evaluate-catalysts picks up due external catalysts (stubbed Claude)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "osd-eval-"));
  await mkdir(path.join(dir, "data"), { recursive: true });
  await mkdir(path.join(dir, "scripts"), { recursive: true });

  // Copy the real script under test into the temp repo.
  await cp(
    path.join(REPO, "scripts", "evaluate-catalysts.mjs"),
    path.join(dir, "scripts", "evaluate-catalysts.mjs"),
  );

  // Minimal internal evaluations file (nothing due).
  await writeFile(
    path.join(dir, "data", "portfolio-evaluations.json"),
    JSON.stringify({ source: "t", note: "t", updated_at: today, evaluations: [] }),
  );
  await writeFile(
    path.join(dir, "data", "portfolio-history.json"),
    JSON.stringify({ current: null, history: [] }),
  );

  // One due (target 10d ago → +7 in the past) and one not-due (target +30d).
  const dueId = "ext_due00001";
  const notId = "ext_not00001";
  await writeFile(
    path.join(dir, "data", "external-catalysts.json"),
    JSON.stringify([
      {
        catalyst_id: dueId,
        ticker: "NVDA",
        catalyst_description: "Q2 earnings AI revenue beats 4.5B",
        target_date: addDays(today, -10),
        submitted_at: today + "T00:00:00Z",
        submitter_contact: null,
        status: "pending",
        judgement_date: null,
        evidence_urls: [],
        reasoning: null,
      },
      {
        catalyst_id: notId,
        ticker: "AAPL",
        catalyst_description: "WWDC reveals a new AI platform",
        target_date: addDays(today, 30),
        submitted_at: today + "T00:00:00Z",
        submitter_contact: null,
        status: "pending",
        judgement_date: null,
        evidence_urls: [],
        reasoning: null,
      },
    ]),
  );

  // Stub @anthropic-ai/sdk: returns a fenced JSON verdict, no web search.
  const stubDir = path.join(dir, "node_modules", "@anthropic-ai", "sdk");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    path.join(stubDir, "package.json"),
    JSON.stringify({ name: "@anthropic-ai/sdk", version: "0.0.0", type: "module", main: "index.mjs" }),
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

  await execFileP("node", ["scripts/evaluate-catalysts.mjs"], {
    cwd: dir,
    env: { ...process.env, ANTHROPIC_API_KEY: "test-key" },
  });

  const out = JSON.parse(
    await readFile(path.join(dir, "data", "external-catalysts.json"), "utf8"),
  );
  const due = out.find((c) => c.catalyst_id === dueId);
  const not = out.find((c) => c.catalyst_id === notId);

  assert.equal(due.status, "hit", "due catalyst should be judged");
  assert.equal(due.judgement_date, today, "judgement_date set to today");
  assert.equal(due.reasoning, "stub verdict");
  assert.equal(not.status, "pending", "not-yet-due catalyst stays pending");
  assert.equal(not.judgement_date, null);
});
