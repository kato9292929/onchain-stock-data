/**
 * Promote IR-Fair companies from `draft` to `review` by researching a dated,
 * falsifiable catalyst for each from primary sources.
 *
 * 184 of the 197 companies are drafts: name and sector only, nothing dated, so
 * nothing scoreable and nothing worth selling. This reads a slice of them,
 * has Claude find the company's next scheduled disclosure and write a catalyst
 * in the Physical-AI format, and writes the result back.
 *
 * COST ACTION. Every company is a Claude call with server-side web search
 * ($10 per 1,000 searches plus tokens). Nothing here runs on a schedule and
 * nothing runs without `--plan`; `--dry-run` needs no API key and makes no
 * request at all. Run it once, read the usage report it prints, and decide.
 *
 * Output lands at `stage: "review"`, never `active`. A reviewed row is still
 * free and still unscored — everything keys on `stage === "active"` — so a
 * human promotes it only after reading the condition. That gate matters
 * because `active` is also what makes the company a paid x402 resource.
 *
 *   npm run research:ir-fair -- --plan infrastructure:7,domestic-defensive:6 --dry-run
 *   npm run research:ir-fair -- --plan infrastructure:7,domestic-defensive:6
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SECTORS } from "../lib/catalyst-sectors.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IR_FAIR_FILE = path.join(ROOT, "data", "ir-fair-2026-catalysts.json");

const MODEL = "claude-sonnet-5";

/**
 * Published rates, 2026-09-22:
 * https://platform.claude.com/docs/en/about-claude/pricing
 * Sonnet 5 — input $2 / MTok, output $10 / MTok, 5m cache write $2.50 / MTok,
 * cache read $0.20 / MTok. Web search $10 per 1,000 searches. Web fetch and
 * (alongside web search) code execution add nothing.
 *
 * Used only to price the usage the run actually reports. If these drift, the
 * token counts in the report stay correct and only the dollar line is stale.
 */
export const RATES = {
  input_per_mtok: 2.0,
  output_per_mtok: 10.0,
  cache_write_per_mtok: 2.5,
  cache_read_per_mtok: 0.2,
  per_search: 0.01,
};

/** Hard ceiling regardless of --plan, so a typo cannot bill the whole roster. */
const MAX_COMPANIES = Number(process.env.RESEARCH_MAX_COMPANIES ?? 20);

/**
 * Cap on server-side web searches per company.
 *
 * The 2026-09-23 run left this unset and averaged 24 searches per company
 * against an estimate of 3. Searches bill twice over: $0.01 each, and every
 * search round re-reads the results accumulated so far, so 21 searches on
 * 1807 pulled 903k cache-read tokens through a single request. Capping the
 * searches caps both, and it keeps a request short enough to finish inside
 * REQUEST_TIMEOUT_MS.
 */
const MAX_SEARCHES = Number(process.env.RESEARCH_MAX_SEARCHES ?? 8);

/**
 * One request's budget, and no retry behind it.
 *
 * The 2026-09-23 run used a 5-minute timeout with the SDK default of 2
 * retries. A company whose search loop needed longer than 5 minutes was cut
 * off and restarted from scratch, three times — the 15m01s failures in that
 * log are exactly 300s x 3. Every abandoned attempt had already run its
 * searches server-side, so it billed, and it returned no usage to count:
 * 24 of that run's ~30 attempts were paid for and thrown away.
 *
 * So wait well past how long the work takes (counted responses came back in
 * 3m49s-4m51s), and never pay for the same company twice without saying so.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS ?? 20 * 60_000);

// ── prompt ────────────────────────────────────────────────────────────────

/**
 * The bar a condition has to clear. The Physical-AI series scores 12/13 on its
 * earnings article, which is either skill or conditions that could not fail —
 * "results are announced", "revenue grows" — and a track record only means
 * something if the second kind is kept out.
 */
const SYSTEM_PROMPT = `あなたは日本株のリサーチアナリストです。1社について、後から機械的に採点できる「日付つきカタリスト」を1つ作ります。

【一次資料のみ】
- 決算短信・有価証券報告書・適時開示・会社IRページ・取引所の開示。これらを web 検索で実際に確認すること。
- 確認できない数値・日付は書かない。推測で埋めない。source には実際に開いた URL を1つ書く。
- EDINET の財務数値抽出は使わない。決算短信など一次資料に書かれている数字だけを使う。

【条件の難易度 — ここが最重要】
- success_condition は「会社計画やコンセンサスに対して上振れ／下振れのどちらもあり得る水準」に置くこと。
- 次のような条件は不可: 「決算が発表される」「増収になる」「開示がある」など、事前にほぼ確実に成立するもの。閾値のない定性的な期待も不可。
- fail_condition には「外れる現実的な道筋」を書く。何が起きたら未達なのかを具体的に。
- 期限までに該当する公表が無ければ **未達（ミス）** として扱われる。これを前提に条件を書くこと。

【期日】
- due_date は一次資料で確認できる予定日（決算発表予定日など）。確認できない場合は、会社が過去に開示している時期から妥当な日付を置き、その根拠を success_condition に含める。

【財務値は任意】
- 決算短信で確認できた場合のみ revenue / operating_income（百万円）/ fiscal_period / disclosed_at を記録する。
- 確認できなければ null のままにする。財務値が無いことは昇格の妨げにならない。

出力は最後に次の JSON のみをコードフェンスで出す:
\`\`\`json
{
  "business_line": "その会社が何で稼いでいるか（1〜2文）",
  "due_date": "YYYY-MM-DD",
  "success_condition": "成立条件。基準値がある場合は数値で。",
  "fail_condition": "外れる現実的な道筋",
  "source": "実際に確認した一次資料の URL",
  "revenue": null,
  "operating_income": null,
  "fiscal_period": null,
  "disclosed_at": null,
  "confidence": "high|medium|low",
  "notes": "確認できなかったこと・判断の留保があれば書く"
}
\`\`\``;

/**
 * Earnings-type sectors need the yardstick inside the condition text.
 * "Beats company guidance" is unscoreable a quarter later unless the guidance
 * number and where it came from are written down at research time.
 */
const EARNINGS_CLAUSE = `
【このセクターは決算判定型です — 基準値を必ず条件文に書く】
- 「会社計画を上回る」のような条件は、基準となる数値そのもの（会社予想の売上／営業利益、前年同期実績、ガイダンスのレンジなど）を success_condition の文中に数値で書くこと。
- その基準値の出典（どの開示のどの数字か）も条件文に含めること。後から読んだ人が、元資料を見ずに何と比べるのかが分かる状態にする。
- 例: 「2027/3期2Q累計の営業利益が会社計画（2026-05-12 決算短信の通期計画 12,000百万円に対する上期進捗率50%＝6,000百万円）を上回る」`;

function userPromptFor(company, section) {
  return `会社: ${company.company_name}（証券コード ${company.ticker}、${company.tse_market ?? "市場不明"}、東証33業種: ${company.sector}）
このセクターの判定タイプ: ${section.decision_type}
セクターの見立て: ${section.analysis}

この会社の次に予定されている開示（決算発表など）を一次資料で確認し、その日付を due_date として、上記の条件でカタリストを1つ作ってください。`;
}

// ── helpers ───────────────────────────────────────────────────────────────

/** The system prompt for one sector — Earnings types carry the extra clause. */
export function systemPromptFor(section) {
  return (
    SYSTEM_PROMPT +
    (String(section.decision_type).includes("Earnings") ? EARNINGS_CLAUSE : "")
  );
}

export function parseArgs(argv) {
  const args = { plan: null, dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--plan=")) args.plan = raw.slice("--plan=".length);
    else if (raw === "--plan") args.plan = "__NEXT__";
    else if (args.plan === "__NEXT__") args.plan = raw;
  }
  return args;
}

/** "infrastructure:7,domestic-defensive:6" → [{slug, count}, …] */
export function parsePlan(spec) {
  const out = [];
  for (const part of spec.split(",")) {
    const [slug, countRaw] = part.split(":");
    const count = Number(countRaw);
    if (!slug || !Number.isFinite(count) || count <= 0) {
      throw new Error(`bad --plan segment: ${part} (expected slug:count)`);
    }
    if (!SECTORS.some((s) => s.slug === slug)) {
      throw new Error(`unknown sector slug: ${slug}`);
    }
    out.push({ slug, count });
  }
  return out;
}

/** The draft companies a plan selects, in file order, capped per sector. */
export function selectCompanies(file, plan) {
  const picked = [];
  for (const { slug, count } of plan) {
    const section = SECTORS.find((s) => s.slug === slug);
    const inSector = file.catalysts.filter(
      (c) => c.stage === "draft" && (section.tse_sectors ?? []).includes(c.sector),
    );
    if (inSector.length < count) {
      console.warn(
        `[research] ${slug}: asked for ${count}, only ${inSector.length} drafts available`,
      );
    }
    for (const company of inSector.slice(0, count)) {
      picked.push({ company, section });
    }
  }
  return picked;
}

function fencedJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

const emptyUsage = () => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
  requests: 0,
});

function addUsage(total, usage) {
  if (!usage) return total;
  total.input_tokens += usage.input_tokens ?? 0;
  total.output_tokens += usage.output_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  total.web_search_requests += usage.server_tool_use?.web_search_requests ?? 0;
  total.requests += 1;
  return total;
}

export function costOf(u) {
  return (
    (u.input_tokens / 1e6) * RATES.input_per_mtok +
    (u.output_tokens / 1e6) * RATES.output_per_mtok +
    (u.cache_creation_input_tokens / 1e6) * RATES.cache_write_per_mtok +
    (u.cache_read_input_tokens / 1e6) * RATES.cache_read_per_mtok +
    u.web_search_requests * RATES.per_search
  );
}

/**
 * Errors where carrying on can only reproduce the same failure, once per
 * remaining company. The 2026-09-23 run hit "credit balance is too low" on
 * company 13 of 13; had it landed on company 3, the other ten would each have
 * spent a request to learn the same thing.
 */
export function isFatalRunError(e) {
  const status = e?.status ?? e?.response?.status;
  if (status === 401 || status === 403) return true;
  return /credit balance is too low|billing|quota|rate limit/i.test(
    String(e?.message ?? ""),
  );
}

// ── one company ───────────────────────────────────────────────────────────

async function researchOne(client, company, section, usageTotal) {
  const system = [
    {
      type: "text",
      // Identical for every company in the run, so each one after the first
      // reads it at 0.1x instead of re-billing it. Input dominates here.
      text: systemPromptFor(section),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
  ];
  const messages = [{ role: "user", content: userPromptFor(company, section) }];
  const textParts = [];

  let resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    tools,
    messages,
  });

  // Server-side web search pauses the turn between search rounds.
  let guard = 0;
  while (true) {
    addUsage(usageTotal, resp.usage);
    for (const block of resp.content) {
      if (block.type === "text") textParts.push(block.text);
    }
    if (resp.stop_reason !== "pause_turn" || guard >= 6) break;
    messages.push({ role: "assistant", content: resp.content });
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools,
      messages,
    });
    guard += 1;
  }

  return fencedJson(textParts.join("\n"));
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || args.plan === "__NEXT__") {
    console.error(
      "::error::--plan is required, e.g. --plan infrastructure:7,domestic-defensive:6",
    );
    process.exit(1);
  }

  const plan = parsePlan(args.plan);
  const file = JSON.parse(await readFile(IR_FAIR_FILE, "utf8"));
  const selected = selectCompanies(file, plan);

  if (selected.length === 0) {
    console.log("[research] nothing to do — no drafts matched the plan");
    return;
  }
  if (selected.length > MAX_COMPANIES) {
    console.error(
      `::error::plan selects ${selected.length} companies, above the ${MAX_COMPANIES} ceiling (RESEARCH_MAX_COMPANIES)`,
    );
    process.exit(1);
  }

  console.log(`[research] ${selected.length} companies, model ${MODEL}`);
  for (const { company, section } of selected) {
    console.log(
      `  ${company.ticker} ${company.company_name} — ${section.slug} (${section.decision_type})`,
    );
  }

  if (args.dryRun) {
    // Offline on purpose: no key, no request, nothing billed. The token figure
    // is a chars/4 approximation of the prompt only — it cannot see how much
    // search output comes back, which is the part that actually dominates.
    const sample = selected[0];
    const promptChars =
      SYSTEM_PROMPT.length +
      EARNINGS_CLAUSE.length +
      userPromptFor(sample.company, sample.section).length;
    console.log(
      `\n[research] DRY RUN — no API calls made.\n` +
        `  prompt ≈ ${Math.round(promptChars / 4)} tokens/company before any search results\n` +
        `  billed per company = prompt + search results (dominant, unknown until measured)\n` +
        `             + output + $${RATES.per_search.toFixed(2)} per web search\n` +
        `  run without --dry-run to measure the real figure`,
    );
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("::error::ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // maxRetries 0 on purpose: a retry here re-runs the entire search loop and
  // bills it again, invisibly — the usage report can only see the attempt that
  // came back. One attempt, a generous timeout, and failures that show up in
  // the report instead of hiding in the invoice.
  const client = new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  const usageTotal = emptyUsage();
  const perCompany = [];
  const failures = [];
  let updated = 0;
  let aborted = null;

  // Written after every company rather than once at the end. A run is hours
  // long and costs real money; a crash, a cancel or a runner going away in the
  // last minute must not take the companies already paid for with it.
  const checkpoint = async () => {
    file.updated_at = new Date().toISOString();
    await writeFile(IR_FAIR_FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  };

  for (const { company, section } of selected) {
    const before = { ...usageTotal };
    try {
      const result = await researchOne(client, company, section, usageTotal);
      const row = file.catalysts.find((c) => c.ticker === company.ticker);

      // stage "review", never "active": a human reads the condition before it
      // becomes scoreable and billable.
      row.stage = "review";
      row.business_line = result.business_line ?? null;
      row.due_date = result.due_date ?? null;
      row.success_condition = result.success_condition ?? null;
      row.fail_condition = result.fail_condition ?? null;
      row.source = result.source ?? null;
      row.revenue = result.revenue ?? null;
      row.operating_income = result.operating_income ?? null;
      row.fiscal_period = result.fiscal_period ?? null;
      row.disclosed_at = result.disclosed_at ?? null;
      row.research = {
        model: MODEL,
        researched_at: new Date().toISOString(),
        decision_type: section.decision_type,
        confidence: result.confidence ?? null,
        notes: result.notes ?? null,
      };
      updated += 1;
      await checkpoint();
      console.log(
        `  ✓ ${company.ticker} ${company.company_name} → review (due ${row.due_date ?? "?"})`,
      );
      // Echo the whole result. On 2026-09-23 the file this run wrote went to
      // the runner's disk, the push was rejected, and the runner was reclaimed
      // — the log had recorded only ticker and due date, so hours of paid
      // research were unrecoverable. The log is the artifact that survives
      // everything, so the content goes in it too.
      console.log(`  ⟨${company.ticker}⟩ ${JSON.stringify(result)}`);
    } catch (e) {
      failures.push({ ticker: company.ticker, message: e.message });
      console.error(`::warning::${company.ticker}: ${e.message}`);
      if (isFatalRunError(e)) aborted = e.message;
    }
    perCompany.push({
      ticker: company.ticker,
      sector: section.slug,
      searches: usageTotal.web_search_requests - before.web_search_requests,
      input: usageTotal.input_tokens - before.input_tokens,
      output: usageTotal.output_tokens - before.output_tokens,
      cache_read: usageTotal.cache_read_input_tokens - before.cache_read_input_tokens,
    });
    if (aborted) {
      console.error(
        `::error::aborting the run after ${company.ticker} — ${aborted}`,
      );
      break;
    }
  }

  if (updated > 0) {
    console.log(`[research] wrote ${IR_FAIR_FILE} (${updated} → stage "review")`);
  }

  // ── usage report ────────────────────────────────────────────────────────
  const total = costOf(usageTotal);
  console.log("\n[research] usage");
  console.log("  ticker  sector                searches   input   output  cache_read");
  for (const r of perCompany) {
    console.log(
      `  ${String(r.ticker).padEnd(7)} ${r.sector.padEnd(22)} ${String(r.searches).padStart(6)}  ${String(r.input).padStart(7)} ${String(r.output).padStart(7)}  ${String(r.cache_read).padStart(9)}`,
    );
  }
  console.log(
    `\n  requests ${usageTotal.requests} · searches ${usageTotal.web_search_requests}` +
      ` · input ${usageTotal.input_tokens} (cache read ${usageTotal.cache_read_input_tokens},` +
      ` write ${usageTotal.cache_creation_input_tokens}) · output ${usageTotal.output_tokens}`,
  );
  // Per *researched* company, not per selected company. Dividing by the whole
  // selection treats a company that failed as one that was free, and the
  // 2026-09-23 report did exactly that: it published $0.3216/company when only
  // 6 of 13 had produced anything, so the true figure was $0.70.
  const perResearched = updated > 0 ? total / updated : 0;
  console.log(
    `  cost $${total.toFixed(4)} total · ${updated}/${selected.length} researched` +
      ` · $${perResearched.toFixed(4)} per researched company` +
      ` · extrapolated to 184 drafts ≈ $${(perResearched * 184).toFixed(2)}`,
  );

  if (failures.length > 0) {
    console.log(`\n[research] ${failures.length} failed`);
    for (const f of failures) console.log(`  ✗ ${f.ticker}: ${f.message}`);
    // Said out loud because the number above cannot include it: a request that
    // times out or errors mid-search has already run those searches on the
    // server and already billed them, and reports no usage back.
    console.log(
      "\n  NOTE: the cost above counts only responses that came back. A failed" +
        " request still ran and still billed, so the invoice is higher than" +
        " this line whenever there are failures. Reconcile against the Console.",
    );
  }

  console.log(
    `\n[research] JSON ${JSON.stringify({ perCompany, failures, aborted, usageTotal, cost_usd: Number(total.toFixed(4)) })}`,
  );
}

// Only when invoked directly. This file is a cost action — importing it (a
// test, a tool) must never start spending.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((e) => {
    console.error(`::error::research-ir-fair failed: ${e.message}`);
    console.error(e);
    process.exit(1);
  });
}
