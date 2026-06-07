/**
 * One-shot backfill: extract a catalyst judgement date + success condition from
 * each holding's free-text `thesis` and seed data/portfolio-evaluations.json
 * with `pending` evaluations.
 *
 * Reads every holding in data/portfolio-history.json (`current` + `history`),
 * dedupes by (week_of, ticker), and for each new pair asks Claude
 * (claude-opus-4-7) to pull out `catalyst_target_date` (ISO 8601) and a concise,
 * machine-readable `success_condition`. When the date can't be extracted it
 * falls back to `week_of + 30 days` (the portfolio horizon is "1m").
 *
 * Idempotent: existing (week_of, ticker) evaluations are kept untouched, so the
 * script can be re-run to pick up newly added picks without clobbering verdicts.
 *
 * Zero-dependency plain Node ESM. The Anthropic SDK (@anthropic-ai/sdk) is
 * imported lazily and only used when ANTHROPIC_API_KEY is set; without a key it
 * falls back to a deterministic local date extractor so the file can still be
 * seeded offline.
 *
 * Run: npm run backfill:catalysts   (node scripts/backfill-catalyst-targets.mjs)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const HISTORY_FILE = path.join(ROOT, "data", "portfolio-history.json");
const OUT_FILE = path.join(ROOT, "data", "portfolio-evaluations.json");
const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `あなたは米国株のイベント分析アシスタントです。与えられた投資 thesis（自由記述）から、catalyst（株価材料）の「判定対象日」と「達成判定の条件」を抽出します。

出力は次の形の JSON のみ（前後に説明文を付けない）:
{
  "catalyst_target_date": "YYYY-MM-DD",   // catalyst が判定可能になる日。ISO 8601。日付が特定できなければ null。
  "success_condition": "..."              // 達成を機械的に判定できる簡潔な日本語の一文。
}

ルール:
- thesis 中の決算日・学会・FOMC・FDA 等の日付を最優先で使う。「6/5 前後」のような表現は 6/5 を採用する。「6/20-23」のような範囲は開始日を採用する。
- 年が書かれていない場合は week_of の年を使う。
- 日付が全く特定できない場合は catalyst_target_date を null にする。
- success_condition は「〜なら hit」と判定できる検証可能な条件に要約する。`;

const round = (n) => Math.round(n);

/** ISO date (YYYY-MM-DD) `n` days after `iso`. */
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Basic YYYY-MM-DD validity check. */
function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Dependency-free fallback: pull the first M/D out of the thesis and anchor it
 * to the week_of year. Used when no API key is available (or a call fails).
 */
function localExtract(thesis, weekOf) {
  const year = Number(weekOf.slice(0, 4));
  const m = String(thesis).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m) {
    const mo = round(Number(m[1]));
    const da = round(Number(m[2]));
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const iso = `${year}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      if (isIsoDate(iso)) {
        return { catalyst_target_date: iso, success_condition: thesis };
      }
    }
  }
  return { catalyst_target_date: addDays(weekOf, 30), success_condition: thesis };
}

function stripCodeFences(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/** Ask Claude to extract the date + condition; fall back on any failure. */
async function apiExtract(client, thesis, weekOf) {
  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `week_of: ${weekOf}\nthesis: ${thesis}\n\nこの thesis から catalyst_target_date と success_condition を抽出し、JSON のみで返してください。`,
        },
      ],
    });
  } catch (e) {
    console.warn(`  [api] extraction failed, using local fallback: ${e.message}`);
    return localExtract(thesis, weekOf);
  }

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    console.warn("  [api] non-JSON response, using local fallback");
    return localExtract(thesis, weekOf);
  }

  const date = isIsoDate(parsed?.catalyst_target_date)
    ? parsed.catalyst_target_date
    : addDays(weekOf, 30);
  const condition =
    typeof parsed?.success_condition === "string" && parsed.success_condition.trim()
      ? parsed.success_condition.trim()
      : thesis;
  return { catalyst_target_date: date, success_condition: condition };
}

async function main() {
  const history = JSON.parse(await readFile(HISTORY_FILE, "utf8"));

  // current first (most authoritative), then history in file order.
  const portfolios = [
    ...(history.current ? [history.current] : []),
    ...(Array.isArray(history.history) ? history.history : []),
  ];

  // Collect (week_of, ticker, thesis), dedupe by (week_of, ticker) keeping first seen.
  const seen = new Set();
  const picks = [];
  for (const p of portfolios) {
    const weekOf = p?.week_of;
    if (!weekOf || !Array.isArray(p.holdings)) continue;
    for (const h of p.holdings) {
      const ticker = String(h.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      const key = `${weekOf}::${ticker}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ week_of: weekOf, ticker, thesis: String(h.thesis ?? "") });
    }
  }

  // Load existing evaluations so re-runs are idempotent.
  let existing = {
    source: "claude-portfolio-evaluations",
    note: "Catalyst evaluations for the weekly Claude Portfolio. Generated by the evaluate-catalysts workflow. Not investment advice.",
    updated_at: null,
    evaluations: [],
  };
  try {
    const prev = JSON.parse(await readFile(OUT_FILE, "utf8"));
    if (prev && Array.isArray(prev.evaluations)) existing = prev;
  } catch {
    /* first run — no file yet */
  }
  const have = new Set(
    existing.evaluations.map((e) => `${e.week_of}::${e.ticker}`),
  );

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let client = null;
  if (apiKey) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic({ apiKey, timeout: 120_000 });
    console.log(`[backfill] using Claude API (${MODEL})`);
  } else {
    console.log("[backfill] ANTHROPIC_API_KEY not set — using local date extractor");
  }

  let added = 0;
  for (const pick of picks) {
    const key = `${pick.week_of}::${pick.ticker}`;
    if (have.has(key)) continue;

    const { catalyst_target_date, success_condition } = client
      ? await apiExtract(client, pick.thesis, pick.week_of)
      : localExtract(pick.thesis, pick.week_of);

    existing.evaluations.push({
      week_of: pick.week_of,
      ticker: pick.ticker,
      catalyst_target_date,
      success_condition,
      status: "pending",
      evaluated_at: null,
      evidence_url: null,
      reasoning: null,
    });
    have.add(key);
    added += 1;
    console.log(
      `  + ${pick.week_of} ${pick.ticker} → ${catalyst_target_date}`,
    );
  }

  existing.updated_at = new Date().toISOString();
  await writeFile(OUT_FILE, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  console.log(
    `[backfill] wrote ${OUT_FILE} (${added} added, ${existing.evaluations.length} total)`,
  );
}

main().catch((e) => {
  console.error("[backfill] unexpected error:", e);
  process.exit(1);
});
