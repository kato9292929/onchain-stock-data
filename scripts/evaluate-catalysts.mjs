/**
 * Daily catalyst evaluation. Reads data/portfolio-evaluations.json and, for
 * every `pending` entry whose `catalyst_target_date + 7 days` has already
 * passed, asks Claude (claude-opus-4-7, web search enabled) to judge the
 * catalyst against the thesis + success_condition + news/price/SEC filings
 * around the target date, and records { status, evidence_url, reasoning }.
 *
 * Anti-hallucination: `evidence_url` is only kept if it actually appears in the
 * web-search results returned during the call; otherwise it is nulled. The
 * prompt also tells Claude never to invent URLs.
 *
 * Writes the updated file back so the workflow can git-commit it. Zero-
 * dependency plain Node ESM apart from @anthropic-ai/sdk (already a dependency).
 *
 * Run: npm run evaluate:catalysts   (node scripts/evaluate-catalysts.mjs)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const EVAL_FILE = path.join(ROOT, "data", "portfolio-evaluations.json");
const HISTORY_FILE = path.join(ROOT, "data", "portfolio-history.json");
const EXTERNAL_FILE = path.join(ROOT, "data", "external-catalysts.json");
const JP_HISTORY_FILE = path.join(ROOT, "data", "jp-portfolio-history.json");
const JP_EVAL_FILE = path.join(ROOT, "data", "jp-portfolio-evaluations.json");
const MODEL = "claude-opus-4-7";
const GRACE_DAYS = 7;
const VALID_STATUS = new Set(["hit", "partial", "miss", "na"]);

const SYSTEM_PROMPT = `あなたは米国株のイベント検証アナリストです。ある銘柄の catalyst（株価材料）が達成されたかを、提示された thesis と success_condition、および対象日付付近の実際のニュース・株価・SEC ファイリングを web 検索で確認して判定します。

判定区分:
- "hit":     success_condition を明確に満たした。
- "partial": 一部は満たしたが完全ではない / 方向性は合うが基準未達。
- "miss":    満たさなかった、または逆方向。
- "na":      catalyst が無効化された（買収・上場廃止・イベント中止など）で判定不能。

厳守事項:
- evidence_url は web 検索結果に実在した URL のみを使う。存在しない URL を絶対に創作しない。確実な裏付けが取れなければ evidence_url は null にする。
- reasoning は日本語で簡潔に、根拠となった事実（数値・日付）を含める。

出力は最後に必ず次の形の JSON を \`\`\`json コードブロックで 1 つだけ出力する:
{
  "status": "hit" | "partial" | "miss" | "na",
  "evidence_url": "https://..." | null,
  "reasoning": "..."
}`;

// Japan-equity variant. Used only when an entry's market is "JP"; the US prompt
// above is unchanged so internal US evaluations behave exactly as before.
const SYSTEM_PROMPT_JP = `あなたは日本株のイベント検証アナリストです。ある銘柄の catalyst（株価材料）が達成されたかを、提示された success_condition と、対象日付付近の実際の決算短信・適時開示（TDnet）・EDINET 提出書類・会社IR資料・日経などの報道を web 検索で確認して判定します。米国の SEC ファイリングではなく、日本の開示制度（決算短信・適時開示・有価証券報告書）を一次情報として優先してください。

判定は次の4値:
- "hit":     success_condition を明確に満たした。
- "partial": 一部は満たしたが完全ではない / 方向性は合うが基準未達。
- "miss":    満たさなかった、または逆方向。
- "na":      対象日付時点で判定材料が出ていない / 確認不能。

- evidence_url は web 検索結果に実在した URL のみを使う。存在しない URL を絶対に創作しない。裏付けが取れなければ evidence_url は null。
- 数値条件（増収増益、ガイダンス据え置き、出荷額前年比 等）は、決算短信の実数値と success_condition を突き合わせて判定する。

最後に次の JSON のみを出力:
{ "status": "hit" | "partial" | "miss" | "na", "evidence_url": "https://..." | null, "reasoning": "..." }`;

// ── Upstash (REST) — JP catalyst store ─────────────────────────────────
// Same protocol/keys as lib/catalyst-upstash.ts, re-implemented with fetch
// because this plain-Node script can't import the TS lib. When the env is unset
// (local / existing tests) every helper is a no-op and the script falls back to
// the committed file exactly as before.
const UPSTASH_SET_KEY = "jp:catalysts";

function upstashConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function upstashBodyKey(ticker, catalystId) {
  return `catalyst:jp:${ticker}:${catalystId}`;
}

async function upstashPipeline(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`upstash pipeline ${res.status}: ${await res.text()}`);
  }
  const replies = await res.json();
  for (const r of replies) {
    if (r && r.error) throw new Error(`upstash command error: ${r.error}`);
  }
  return replies;
}

async function upstashListCatalysts() {
  if (!upstashConfigured()) return [];
  const [members] = await upstashPipeline([["SMEMBERS", UPSTASH_SET_KEY]]);
  const keys = members?.result ?? [];
  if (!keys.length) return [];
  const [values] = await upstashPipeline([["MGET", ...keys]]);
  const out = [];
  for (const v of values?.result ?? []) {
    if (!v) continue;
    try {
      out.push(JSON.parse(v));
    } catch {
      // skip corrupt entry
    }
  }
  return out;
}

async function upstashPutCatalyst(c) {
  const key = upstashBodyKey(c.ticker, c.catalyst_id);
  await upstashPipeline([
    ["SET", key, JSON.stringify(c)],
    ["SADD", UPSTASH_SET_KEY, key],
  ]);
}

/** ISO date `n` days after `iso` (YYYY-MM-DD). */
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Recursively collect every `url` string under web_search_tool_result blocks. */
function collectSearchUrls(blocks, urls) {
  if (Array.isArray(blocks)) {
    for (const b of blocks) collectSearchUrls(b, urls);
    return;
  }
  if (!blocks || typeof blocks !== "object") return;
  if (typeof blocks.url === "string" && /^https?:\/\//.test(blocks.url)) {
    urls.add(blocks.url);
  }
  for (const v of Object.values(blocks)) {
    if (v && typeof v === "object") collectSearchUrls(v, urls);
  }
}

function extractJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  // Fall back to the last {...} block if no fence.
  const candidate = fence
    ? raw
    : (raw.match(/\{[\s\S]*\}/) || [raw])[0];
  return JSON.parse(candidate.trim());
}

/**
 * Judge one catalyst. `entry` is normalised to:
 *   { ticker, targetDate, condition, context }
 * so internal portfolio evaluations and external submissions share the exact
 * same Claude + web-search logic and anti-hallucination URL filtering.
 */
async function evaluateOne(
  client,
  { ticker, targetDate, condition, context, market = "US" },
) {
  const isJp = market === "JP";
  const system = isJp ? SYSTEM_PROMPT_JP : SYSTEM_PROMPT;
  const sources = isJp
    ? "決算短信・適時開示・会社IR・日経など"
    : "実際のニュース・株価・SEC ファイリング";
  const webSearch = { type: "web_search_20260209", name: "web_search" };
  const userPrompt = `銘柄: ${ticker}
catalyst_target_date: ${targetDate}
${context ? `${context}\n` : ""}success_condition: ${condition}

${targetDate} 前後の${sources}を web 検索で確認し、success_condition の達成可否を判定してください。最後に指定の JSON を出力してください。`;

  const messages = [{ role: "user", content: userPrompt }];
  const searchUrls = new Set();
  const textParts = [];

  let resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    tools: [webSearch],
    messages,
  });

  // Server-side web search runs a tool loop that can pause with `pause_turn`.
  let guard = 0;
  while (true) {
    collectSearchUrls(resp.content, searchUrls);
    for (const b of resp.content) {
      if (b.type === "text") textParts.push(b.text);
    }
    if (resp.stop_reason !== "pause_turn" || guard >= 6) break;
    messages.push({ role: "assistant", content: resp.content });
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools: [webSearch],
      messages,
    });
    guard += 1;
  }

  let parsed;
  try {
    parsed = extractJson(textParts.join("\n"));
  } catch (e) {
    throw new Error(`could not parse verdict JSON: ${e.message}`);
  }

  const status = VALID_STATUS.has(parsed?.status) ? parsed.status : "na";
  // Only keep an evidence_url that actually showed up in the search results.
  let evidence_url = null;
  if (typeof parsed?.evidence_url === "string" && parsed.evidence_url) {
    evidence_url = searchUrls.has(parsed.evidence_url) ? parsed.evidence_url : null;
  }
  const reasoning =
    typeof parsed?.reasoning === "string" ? parsed.reasoning.trim() : null;

  return { status, evidence_url, reasoning };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("::error::ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }

  const evalsFile = JSON.parse(await readFile(EVAL_FILE, "utf8"));
  const evaluations = Array.isArray(evalsFile.evaluations)
    ? evalsFile.evaluations
    : [];

  // Build a (week_of, ticker) → thesis lookup from portfolio history.
  const thesisByKey = new Map();
  try {
    const history = JSON.parse(await readFile(HISTORY_FILE, "utf8"));
    const portfolios = [
      ...(history.current ? [history.current] : []),
      ...(Array.isArray(history.history) ? history.history : []),
    ];
    for (const p of portfolios) {
      if (!p?.week_of || !Array.isArray(p.holdings)) continue;
      for (const h of p.holdings) {
        const key = `${p.week_of}::${String(h.ticker ?? "").toUpperCase()}`;
        if (!thesisByKey.has(key)) thesisByKey.set(key, String(h.thesis ?? ""));
      }
    }
  } catch (e) {
    console.warn(`[evaluate] could not load thesis lookup: ${e.message}`);
  }

  // External submissions (Phase A). The committed file is the US/legacy store;
  // Upstash is the source of truth for JP. Merge by catalyst_id (Upstash wins),
  // but keep fileExternals separate so we only git-commit the file-backed ones.
  let fileExternals = [];
  try {
    const raw = JSON.parse(await readFile(EXTERNAL_FILE, "utf8"));
    if (Array.isArray(raw)) fileExternals = raw;
  } catch (e) {
    console.warn(`[evaluate] no external catalysts file: ${e.message}`);
  }
  let upExternals = [];
  if (upstashConfigured()) {
    try {
      upExternals = await upstashListCatalysts();
    } catch (e) {
      console.warn(`[evaluate] upstash list failed, file only: ${e.message}`);
    }
  }
  const externalsById = new Map();
  for (const c of fileExternals) externalsById.set(c.catalyst_id, c);
  for (const c of upExternals) externalsById.set(c.catalyst_id, c);
  const externals = [...externalsById.values()];

  // ── JP portfolio catalysts: auto-register pending evaluations from
  //    jp-portfolio-history.json (each holding's dated thesis), then judge with
  //    the JP prompt. Mirror of the US internal flow, self-bootstrapping (no
  //    backfill step). git-committed file is the only store.
  let jpEvalsFile = null;
  let jpEvaluations = [];
  let jpCreated = 0;
  try {
    const jpHistory = JSON.parse(await readFile(JP_HISTORY_FILE, "utf8"));
    try {
      jpEvalsFile = JSON.parse(await readFile(JP_EVAL_FILE, "utf8"));
    } catch {
      jpEvalsFile = {
        source: "claude-jp-portfolio-evaluations",
        note: "",
        updated_at: new Date().toISOString(),
        evaluations: [],
      };
    }
    jpEvaluations = Array.isArray(jpEvalsFile.evaluations)
      ? jpEvalsFile.evaluations
      : [];
    const jpSeen = new Set(
      jpEvaluations.map((e) => `${e.week_of}::${String(e.ticker).toUpperCase()}`),
    );
    const jpPortfolios = [
      ...(jpHistory.current ? [jpHistory.current] : []),
      ...(Array.isArray(jpHistory.history) ? jpHistory.history : []),
    ];
    for (const p of jpPortfolios) {
      if (!p?.week_of || !Array.isArray(p.holdings)) continue;
      for (const h of p.holdings) {
        const ticker = String(h.ticker ?? "").toUpperCase();
        if (!ticker || !h.target_date) continue;
        const key = `${p.week_of}::${ticker}`;
        if (jpSeen.has(key)) continue;
        jpSeen.add(key);
        jpEvaluations.push({
          week_of: p.week_of,
          ticker,
          catalyst_target_date: h.target_date,
          success_condition: String(h.thesis ?? ""),
          status: "pending",
          evaluated_at: null,
          evidence_url: null,
          reasoning: null,
        });
        jpCreated += 1;
      }
    }
  } catch (e) {
    console.warn(`[evaluate] no JP portfolio history: ${e.message}`);
  }

  const today = todayIso();
  const dueInternal = evaluations.filter(
    (e) =>
      e.status === "pending" &&
      addDays(e.catalyst_target_date, GRACE_DAYS) <= today,
  );
  const dueExternal = externals.filter(
    (e) =>
      e.status === "pending" && addDays(e.target_date, GRACE_DAYS) <= today,
  );
  const dueJp = jpEvaluations.filter(
    (e) =>
      e.status === "pending" &&
      e.catalyst_target_date &&
      addDays(e.catalyst_target_date, GRACE_DAYS) <= today,
  );

  console.log(
    `[evaluate] internal ${dueInternal.length}/${evaluations.length}, ` +
      `external ${dueExternal.length}/${externals.length}, ` +
      `jp ${dueJp.length}/${jpEvaluations.length} due (as of ${today})`,
  );

  const anyDue =
    dueInternal.length > 0 || dueExternal.length > 0 || dueJp.length > 0;
  if (!anyDue && jpCreated === 0) {
    console.log("[evaluate] nothing due — exiting without changes");
    return;
  }

  // Only need the API client when something is actually due; a JP-only bootstrap
  // (newly registered pending rows, nothing due yet) just writes the file.
  let client = null;
  if (anyDue) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic({ apiKey, timeout: 300_000 });
  }

  // ── Internal portfolio evaluations ──────────────────────────────────
  let internalUpdated = 0;
  for (const entry of dueInternal) {
    const thesis = thesisByKey.get(`${entry.week_of}::${entry.ticker}`) ?? "";
    try {
      const verdict = await evaluateOne(client, {
        ticker: entry.ticker,
        targetDate: entry.catalyst_target_date,
        condition: entry.success_condition,
        context: `週: ${entry.week_of}\nthesis: ${thesis || "(thesis 不明)"}`,
      });
      entry.status = verdict.status;
      entry.evidence_url = verdict.evidence_url;
      entry.reasoning = verdict.reasoning;
      entry.evaluated_at = new Date().toISOString();
      internalUpdated += 1;
      console.log(
        `  ✓ [int] ${entry.week_of} ${entry.ticker} → ${verdict.status}` +
          (verdict.evidence_url ? ` (${verdict.evidence_url})` : ""),
      );
    } catch (e) {
      console.error(`::warning::${entry.week_of} ${entry.ticker}: ${e.message}`);
    }
  }

  // ── External submissions ────────────────────────────────────────────
  let externalUpdated = 0;
  let fileExternalsDirty = false;
  for (const entry of dueExternal) {
    try {
      // Event-type catalysts are asymmetric: the success is that a specific
      // disclosure/event HAPPENS by target_date, so ABSENCE by the deadline is
      // a `miss`, not `na`. Spell this out so it overrides the JP prompt's
      // default of treating "no material by the date" as `na`.
      const eventRule =
        entry.catalyst_type === "event"
          ? "\n【判定ルール】これはイベント型 catalyst。target_date までに success_condition を満たす開示・事実が web 検索で確認できない場合は miss とすること（『何も公表されない＝miss』。na にはしない）。買収・上場廃止・事業消滅など catalyst 自体が無効化された場合のみ na。"
          : "";
      const verdict = await evaluateOne(client, {
        ticker: entry.ticker,
        targetDate: entry.target_date,
        condition: entry.catalyst_description,
        context: `外部提出 catalyst（submitter による）${eventRule}`,
        market: entry.market === "JP" ? "JP" : "US",
      });
      entry.status = verdict.status;
      // External schema uses evidence_urls[] (plural); keep the verified one.
      entry.evidence_urls = verdict.evidence_url ? [verdict.evidence_url] : [];
      entry.reasoning = verdict.reasoning;
      entry.judgement_date = todayIso();
      externalUpdated += 1;
      // JP verdicts go back to Upstash (the source of truth); file-backed
      // (US/legacy) entries are git-committed below.
      if (entry.market === "JP" && upstashConfigured()) {
        try {
          await upstashPutCatalyst(entry);
        } catch (e) {
          console.error(`::warning::upstash put ${entry.catalyst_id}: ${e.message}`);
        }
      }
      if (fileExternals.includes(entry)) fileExternalsDirty = true;
      console.log(
        `  ✓ [ext] ${entry.catalyst_id} ${entry.ticker} → ${verdict.status}` +
          (verdict.evidence_url ? ` (${verdict.evidence_url})` : ""),
      );
    } catch (e) {
      console.error(`::warning::${entry.catalyst_id} ${entry.ticker}: ${e.message}`);
    }
  }

  // ── JP portfolio catalysts ──────────────────────────────────────────
  let jpJudged = 0;
  for (const entry of dueJp) {
    try {
      const verdict = await evaluateOne(client, {
        ticker: entry.ticker,
        targetDate: entry.catalyst_target_date,
        condition: entry.success_condition,
        context: `週: ${entry.week_of}`,
        market: "JP",
      });
      entry.status = verdict.status;
      entry.evidence_url = verdict.evidence_url;
      entry.reasoning = verdict.reasoning;
      entry.evaluated_at = new Date().toISOString();
      jpJudged += 1;
      console.log(
        `  ✓ [jp] ${entry.week_of} ${entry.ticker} → ${verdict.status}` +
          (verdict.evidence_url ? ` (${verdict.evidence_url})` : ""),
      );
    } catch (e) {
      console.error(`::warning::jp ${entry.week_of} ${entry.ticker}: ${e.message}`);
    }
  }

  if (internalUpdated > 0) {
    evalsFile.updated_at = new Date().toISOString();
    await writeFile(EVAL_FILE, `${JSON.stringify(evalsFile, null, 2)}\n`, "utf8");
    console.log(`[evaluate] wrote ${EVAL_FILE} (${internalUpdated} updated)`);
  }
  if (fileExternalsDirty) {
    await writeFile(
      EXTERNAL_FILE,
      `${JSON.stringify(fileExternals, null, 2)}\n`,
      "utf8",
    );
    console.log(`[evaluate] wrote ${EXTERNAL_FILE}`);
  }
  // Persist JP evaluations when rows were registered and/or judged.
  if ((jpCreated > 0 || jpJudged > 0) && jpEvalsFile) {
    jpEvalsFile.updated_at = new Date().toISOString();
    jpEvalsFile.evaluations = jpEvaluations;
    await writeFile(JP_EVAL_FILE, `${JSON.stringify(jpEvalsFile, null, 2)}\n`, "utf8");
    console.log(
      `[evaluate] wrote ${JP_EVAL_FILE} (registered ${jpCreated}, judged ${jpJudged})`,
    );
  }
  if (
    internalUpdated === 0 &&
    externalUpdated === 0 &&
    jpJudged === 0 &&
    jpCreated === 0
  ) {
    console.log("[evaluate] no entries updated");
  }
}

main().catch((e) => {
  console.error(`::error::evaluate-catalysts failed: ${e.message}`);
  console.error(e);
  process.exit(1);
});
