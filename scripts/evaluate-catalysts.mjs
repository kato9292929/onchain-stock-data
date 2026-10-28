/**
 * Daily catalyst evaluation. Reads data/portfolio-evaluations.json and, for
 * every `pending` entry whose `catalyst_target_date + 7 days` has already
 * passed, asks Claude (claude-sonnet-5, web search enabled) to judge the
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
import { fileURLToPath } from "node:url";
import { isFatalRunError } from "./lib/run-errors.mjs";

const ROOT = process.cwd();
const EVAL_FILE = path.join(ROOT, "data", "portfolio-evaluations.json");
const HISTORY_FILE = path.join(ROOT, "data", "portfolio-history.json");
const EXTERNAL_FILE = path.join(ROOT, "data", "external-catalysts.json");
const JP_HISTORY_FILE = path.join(ROOT, "data", "jp-portfolio-history.json");
const JP_EVAL_FILE = path.join(ROOT, "data", "jp-portfolio-evaluations.json");
const MODEL = "claude-sonnet-5";

/**
 * Cap on server-side web searches per catalyst.
 *
 * There was none. The research script had none either and averaged 24 searches
 * a company against an estimate of 3 — searches bill at $0.01 and drag their
 * results through every later round as cache reads, so an uncapped loop is how
 * a job overruns 8x without anyone noticing. Verifying one dated condition
 * against a known disclosure needs far fewer searches than open-ended research.
 */
const MAX_SEARCHES = Number(process.env.EVALUATE_MAX_SEARCHES ?? 8);

/**
 * Published rates, 2026-10-15 (platform.claude.com/docs/en/about-claude/pricing).
 * Used only to price the usage a run actually reports — if they drift, the
 * token counts stay correct and only the dollar line is stale.
 */
const RATES = {
  input_per_mtok: 2.0,
  output_per_mtok: 10.0,
  cache_write_per_mtok: 2.5,
  cache_read_per_mtok: 0.2,
  per_search: 0.01,
};

/** Every run's usage, so the next estimate has a measured basis. */
const usageTotal = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
  requests: 0,
};

function addUsage(u) {
  if (!u) return;
  usageTotal.input_tokens += u.input_tokens ?? 0;
  usageTotal.output_tokens += u.output_tokens ?? 0;
  usageTotal.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  usageTotal.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  usageTotal.web_search_requests += u.server_tool_use?.web_search_requests ?? 0;
  usageTotal.requests += 1;
}

function costOf(u) {
  return (
    (u.input_tokens / 1e6) * RATES.input_per_mtok +
    (u.output_tokens / 1e6) * RATES.output_per_mtok +
    (u.cache_creation_input_tokens / 1e6) * RATES.cache_write_per_mtok +
    (u.cache_read_input_tokens / 1e6) * RATES.cache_read_per_mtok +
    u.web_search_requests * RATES.per_search
  );
}
const GRACE_DAYS = 7;

/**
 * US portfolio holdings are auto-registered as pending evaluations only from
 * this week onward.
 *
 * The US flow was never self-bootstrapping the way JP is: rows came from a
 * one-shot backfill (scripts/backfill-catalyst-targets.mjs), so once those were
 * judged in July 2026 nothing new was ever registered and the US scorecard
 * froze — reporting `pending: 0`, which reads as "nothing waiting" rather than
 * "nothing exists". It stayed that way for three months.
 *
 * The 90 holdings from the weeks in between (2026-06-29 … 2026-09-14) are now
 * permanently out of scope, and the 49 before 2026-06-15 never had a
 * `target_date` to be judged against. See the constant's own docs for why.
 *
 * `lib/evaluation-coverage.ts` carries the same constant for the scorecard
 * endpoint and the coverage check. It is duplicated rather than imported
 * because this script runs under plain `node` (see package.json) and cannot
 * load a `.ts` module — importing one breaks the weekly cron. The copies are
 * pinned to each other by a test in evaluation-coverage.test.mjs, so they
 * cannot drift silently.
 */
const US_AUTOREGISTER_FROM = process.env.US_AUTOREGISTER_FROM ?? "2026-09-21";
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
 * Split "成立条件【外れ方向】外れるシナリオ" into its two halves.
 *
 * The external catalysts fold both into one `catalyst_description`, and it used
 * to be handed to the model whole, under the label `success_condition:`. So the
 * model was told that the fail scenario WAS the success condition, and it
 * sometimes judged that instead — ext_e5d99360 says so in as many words:
 * 「submitterの【外れ方向】success_condition（Q4ガイダンスがQoQ増収を示さない）は
 * 満たされておらず、miss判定」. QCOM's automotive grew +61% against a ~+50%
 * condition and was recorded a miss.
 *
 * Duplicated from `splitDescription` in lib/physical-ai-scoreboard.ts because
 * this script runs under plain `node` and cannot import a .ts module; the two
 * are pinned to each other by a test.
 */
export function splitCondition(description) {
  const text = String(description ?? "");
  const marker = "【外れ方向】";
  const i = text.indexOf(marker);
  if (i < 0) return { success: text.trim(), failDirection: null };
  return {
    success: text.slice(0, i).trim(),
    failDirection: text.slice(i + marker.length).trim() || null,
  };
}

/**
 * Judge one catalyst. `entry` is normalised to:
 *   { ticker, targetDate, condition, context, asOf }
 * so internal portfolio evaluations and external submissions share the exact
 * same Claude + web-search logic and anti-hallucination URL filtering.
 */
async function evaluateOne(
  client,
  { ticker, targetDate, condition, context, market = "US", asOf },
) {
  const isJp = market === "JP";
  const system = isJp ? SYSTEM_PROMPT_JP : SYSTEM_PROMPT;
  // Cache the (large, identical-per-market) system prompt so every catalyst
  // after the first — and every pause_turn continuation within a call — reads
  // it from cache instead of re-billing the full input each time. Input is the
  // dominant cost here (search-heavy, ~27:1 in:out), so this is the main lever.
  const systemBlocks = [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
  ];
  const sources = isJp
    ? "決算短信・適時開示・会社IR・日経など"
    : "実際のニュース・株価・SEC ファイリング";
  const webSearch = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: MAX_SEARCHES,
  };
  const { success, failDirection } = splitCondition(condition);
  // The ONLY date in this prompt used to be the selection week, which the model
  // read as today: 3110 was judged on 2026-08-13 and still concluded
  // 「現在の週は2026-06-29であり、対象日付（8/5）まで約5週間先」 for a 短信 that had
  // been out for eight days. Seven `na` rows came from that. State today first,
  // and say plainly that the target date is in the past.
  const today = asOf ?? todayIso();
  const userPrompt = `本日（判定実施日）: ${today}
銘柄: ${ticker}
catalyst_target_date: ${targetDate}（本日より過去。すでに到来済みの日付として扱うこと）
${context ? `${context}\n` : ""}success_condition: ${success}
${failDirection ? `fail_direction（参考。成立しなかった場合に観測される事象。**これは判定対象ではない**）: ${failDirection}\n` : ""}
${targetDate} 前後の${sources}を web 検索で確認し、**success_condition** の達成可否のみを判定してください。fail_direction は背景情報であり、その成否を判定してはいけません。最後に指定の JSON を出力してください。`;

  const messages = [{ role: "user", content: userPrompt }];
  const searchUrls = new Set();
  const textParts = [];

  let resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemBlocks,
    tools: [webSearch],
    messages,
  });

  // Server-side web search runs a tool loop that can pause with `pause_turn`.
  let guard = 0;
  while (true) {
    addUsage(resp.usage);
    collectSearchUrls(resp.content, searchUrls);
    for (const b of resp.content) {
      if (b.type === "text") textParts.push(b.text);
    }
    if (resp.stop_reason !== "pause_turn" || guard >= 6) break;
    messages.push({ role: "assistant", content: resp.content });
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemBlocks,
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

/**
 * Whether a run that was asked to judge something actually did.
 *
 * On 2026-10-25 every call returned `401 invalid x-api-key`; each failure was
 * logged as a ::warning::, the run printed "no entries updated", and the job
 * went green. Nobody looks at a green job. A run that was aborted by an
 * auth/billing error, or that attempted judgements and landed none, is a
 * failure and must exit non-zero.
 *
 * Pure, so the rule is testable without a client.
 */
export function runOutcome({ attempted, judged, aborted }) {
  if (aborted) {
    return {
      ok: false,
      message: `run aborted after ${judged}/${attempted} judged: ${aborted}`,
    };
  }
  if (attempted > 0 && judged === 0) {
    return {
      ok: false,
      message: `all ${attempted} judgement(s) failed — nothing was judged`,
    };
  }
  return { ok: true, message: null };
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

  // Build a (week_of, ticker) → thesis lookup from portfolio history, and
  // auto-register pending rows for recent weeks (see US_AUTOREGISTER_FROM).
  const thesisByKey = new Map();
  // (week_of, ticker) → the date the company actually published, where a
  // reconciliation found one that differs from the condition's own deadline.
  const confirmedByKey = new Map();
  let internalCreated = 0;
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
        if (h.target_date_confirmed && !confirmedByKey.has(key)) {
          confirmedByKey.set(key, String(h.target_date_confirmed));
        }
      }
    }

    // Mirror of the JP self-bootstrapping block below, windowed to recent
    // weeks. Holdings without a `target_date` (every week before 2026-06-29)
    // are skipped — there is nothing to judge them against.
    const usSeen = new Set(
      evaluations.map(
        (e) => `${e.week_of}::${String(e.ticker ?? "").toUpperCase()}`,
      ),
    );
    for (const p of portfolios) {
      if (!p?.week_of || !Array.isArray(p.holdings)) continue;
      if (p.week_of < US_AUTOREGISTER_FROM) continue;
      for (const h of p.holdings) {
        const ticker = String(h.ticker ?? "").toUpperCase();
        if (h.target_date_confirmed) {
          const k = `${p.week_of}::${ticker}`;
          if (!confirmedByKey.has(k)) {
            confirmedByKey.set(k, String(h.target_date_confirmed));
          }
        }
        if (!ticker || !h.target_date) continue;
        const key = `${p.week_of}::${ticker}`;
        if (usSeen.has(key)) continue;
        usSeen.add(key);
        evaluations.push({
          week_of: p.week_of,
          ticker,
          catalyst_target_date: h.target_date,
          // The holdings carry no distilled condition — only the free-text
          // thesis — so it goes in verbatim, exactly as the JP flow does. Rows
          // seeded by the old backfill carry a Claude-distilled condition
          // instead, so the two generations differ in granularity and
          // `condition_source` keeps them separable when hit-rates are
          // aggregated. Do not compare the two without splitting on it.
          success_condition: String(h.thesis ?? ""),
          condition_source: "thesis",
          status: "pending",
          evaluated_at: null,
          evidence_url: null,
          reasoning: null,
        });
        internalCreated += 1;
      }
    }
    if (internalCreated > 0) {
      console.log(
        `[evaluate] registered ${internalCreated} US pending rows (weeks >= ${US_AUTOREGISTER_FROM})`,
      );
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
          // Free-text thesis, not a distilled condition — see the US block.
          condition_source: "thesis",
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

  /**
   * When judging may start.
   *
   * The deadline on a condition is the model's own date, unchecked — 8035's
   * 2026-10-12 row said 10-29 while the company's IR page said 10-30, and
   * 6857's said 11-05 against a published 10-28. The seven-day grace absorbs a
   * small error, but a condition dated eight or more days EARLY would be judged
   * before the disclosure exists and scored a miss for silence that never
   * happened. Where a reconciliation recorded what the company actually
   * published, wait for the later of the two.
   *
   * `target_date` itself is never moved: a condition is fixed when published.
   */
  const judgeableFrom = (targetDate, key) => {
    const confirmed = key ? confirmedByKey.get(key) : undefined;
    const basis =
      confirmed && confirmed > targetDate ? confirmed : targetDate;
    return addDays(basis, GRACE_DAYS);
  };
  const keyOf = (e) => `${e.week_of}::${String(e.ticker ?? "").toUpperCase()}`;

  const dueInternal = evaluations.filter(
    (e) =>
      e.status === "pending" &&
      judgeableFrom(e.catalyst_target_date, keyOf(e)) <= today,
  );
  const dueExternal = externals.filter(
    (e) =>
      // External submissions have no portfolio week to reconcile against.
      e.status === "pending" && addDays(e.target_date, GRACE_DAYS) <= today,
  );
  const dueJp = jpEvaluations.filter(
    (e) =>
      e.status === "pending" &&
      e.catalyst_target_date &&
      judgeableFrom(e.catalyst_target_date, keyOf(e)) <= today,
  );

  console.log(
    `[evaluate] internal ${dueInternal.length}/${evaluations.length}, ` +
      `external ${dueExternal.length}/${externals.length}, ` +
      `jp ${dueJp.length}/${jpEvaluations.length} due (as of ${today})`,
  );

  const anyDue =
    dueInternal.length > 0 || dueExternal.length > 0 || dueJp.length > 0;
  if (!anyDue && jpCreated === 0 && internalCreated === 0) {
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

  // Backlog-burst guard. After an outage or a pause, many catalysts come due at
  // once; judging them all in one run is what turned the Aug-21 post-topup run
  // into a ~2-hour, ~$15 job. Cap the number judged per run — oldest-due first —
  // and leave the rest `pending` for subsequent daily runs, so a backlog drains
  // over days instead of firing as one costly batch. Tune via EVALUATE_MAX_PER_RUN.
  const MAX_PER_RUN = Number(process.env.EVALUATE_MAX_PER_RUN ?? 12);

  // The cap is shared by all three lanes, and it used to be spent by merging
  // them and judging the globally oldest first. That starves whichever lane has
  // newer dates: a single lane sitting on a backlog of old catalysts would take
  // every slot for weeks while the others waited. Take from each lane in turn
  // instead — still oldest-first WITHIN a lane, so nothing jumps its queue, but
  // every lane makes progress on every run. The per-run ceiling is unchanged,
  // so this costs exactly what it did before.
  const byDate = (a, b) => (a.date < b.date ? -1 : 1);
  const lanes = [
    dueInternal.map((e) => ({ e, date: e.catalyst_target_date })).sort(byDate),
    dueExternal.map((e) => ({ e, date: e.target_date })).sort(byDate),
    dueJp.map((e) => ({ e, date: e.catalyst_target_date })).sort(byDate),
  ];
  const picked = [];
  for (let rank = 0; picked.length < MAX_PER_RUN; rank += 1) {
    let tookAny = false;
    for (const lane of lanes) {
      if (picked.length >= MAX_PER_RUN) break;
      if (rank >= lane.length) continue;
      picked.push(lane[rank]);
      tookAny = true;
    }
    if (!tookAny) break; // every lane exhausted
  }
  const runSet = new Set(picked.map((t) => t.e));
  const totalDue = lanes.reduce((n, lane) => n + lane.length, 0);
  if (totalDue > MAX_PER_RUN) {
    console.log(
      `[evaluate] backlog guard: ${totalDue} due (us ${lanes[0].length}, ` +
        `external ${lanes[1].length}, jp ${lanes[2].length}), judging ` +
        `${picked.length} this run — oldest first within each lane, taken in ` +
        `turn so no lane starves — deferring ${totalDue - picked.length}`,
    );
  }

  // Fail-fast bookkeeping. `aborted` is set by the first error that would
  // repeat for every remaining catalyst (auth, billing); after it, no lane
  // makes another call.
  let attempted = 0;
  let aborted = null;
  const onFailure = (e, label) => {
    console.error(`::warning::${label}: ${e.message}`);
    if (isFatalRunError(e)) aborted = e.message;
  };

  // ── Internal portfolio evaluations ──────────────────────────────────
  let internalUpdated = 0;
  for (const entry of dueInternal) {
    if (!runSet.has(entry)) continue; // deferred by the backlog guard
    if (aborted) break;
    attempted += 1;
    const thesis = thesisByKey.get(`${entry.week_of}::${entry.ticker}`) ?? "";
    try {
      const verdict = await evaluateOne(client, {
        ticker: entry.ticker,
        targetDate: entry.catalyst_target_date,
        condition: entry.success_condition,
        // Labelled as the week the pick was MADE, not as "now" — the bare
        // `週:` reads as today and produced seven premature `na` verdicts.
        context: `この銘柄が選定された週（過去）: ${entry.week_of}\nthesis: ${thesis || "(thesis 不明)"}`,
        asOf: todayIso(),
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
      onFailure(e, `${entry.week_of} ${entry.ticker}`);
    }
  }

  // ── External submissions ────────────────────────────────────────────
  let externalUpdated = 0;
  let fileExternalsDirty = false;
  for (const entry of dueExternal) {
    if (!runSet.has(entry)) continue; // deferred by the backlog guard
    if (aborted) break;
    attempted += 1;
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
        asOf: todayIso(),
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
      onFailure(e, `${entry.catalyst_id} ${entry.ticker}`);
    }
  }

  // ── JP portfolio catalysts ──────────────────────────────────────────
  let jpJudged = 0;
  for (const entry of dueJp) {
    if (!runSet.has(entry)) continue; // deferred by the backlog guard
    if (aborted) break;
    attempted += 1;
    try {
      const verdict = await evaluateOne(client, {
        ticker: entry.ticker,
        targetDate: entry.catalyst_target_date,
        condition: entry.success_condition,
        context: `この銘柄が選定された週（過去）: ${entry.week_of}`,
        market: "JP",
        asOf: todayIso(),
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
      onFailure(e, `jp ${entry.week_of} ${entry.ticker}`);
    }
  }

  // Persist US evaluations when rows were registered and/or judged.
  if (internalUpdated > 0 || internalCreated > 0) {
    evalsFile.updated_at = new Date().toISOString();
    evalsFile.evaluations = evaluations;
    await writeFile(EVAL_FILE, `${JSON.stringify(evalsFile, null, 2)}\n`, "utf8");
    console.log(
      `[evaluate] wrote ${EVAL_FILE} (registered ${internalCreated}, judged ${internalUpdated})`,
    );
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
    internalCreated === 0 &&
    externalUpdated === 0 &&
    jpJudged === 0 &&
    jpCreated === 0
  ) {
    console.log("[evaluate] no entries updated");
  }

  // Say what the run spent. Until now nothing here measured it, so every
  // estimate of "what would re-judging N catalysts cost" was a guess.
  if (usageTotal.requests > 0) {
    const judged = internalUpdated + externalUpdated + jpJudged;
    const total = costOf(usageTotal);
    console.log(
      `\n[evaluate] usage: requests ${usageTotal.requests} · searches ${usageTotal.web_search_requests}` +
        ` · input ${usageTotal.input_tokens} (cache read ${usageTotal.cache_read_input_tokens},` +
        ` write ${usageTotal.cache_creation_input_tokens}) · output ${usageTotal.output_tokens}`,
    );
    console.log(
      `[evaluate] cost $${total.toFixed(4)} total` +
        (judged > 0
          ? ` · ${judged} judged · $${(total / judged).toFixed(4)} per catalyst`
          : ""),
    );
    console.log(`[evaluate] JSON ${JSON.stringify({ usageTotal, cost_usd: Number(total.toFixed(4)), judged })}`);
  }

  // Last, so whatever WAS judged is already on disk; the workflow's commit
  // step runs on `!cancelled()` and keeps it, while the job still goes red.
  const outcome = runOutcome({
    attempted,
    judged: internalUpdated + externalUpdated + jpJudged,
    aborted,
  });
  if (!outcome.ok) {
    console.error(`::error::${outcome.message}`);
    process.exitCode = 1;
  }
}

// Only when invoked directly. This script bills Claude plus web search, so
// importing it — from a test, a tool — must never start a run. (Mirrors
// scripts/research-ir-fair.mjs, which learned this the expensive way.)
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((e) => {
    console.error(`::error::evaluate-catalysts failed: ${e.message}`);
    console.error(e);
    process.exit(1);
  });
}
