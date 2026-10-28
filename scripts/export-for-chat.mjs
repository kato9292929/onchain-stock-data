#!/usr/bin/env node
/**
 * Write the week's work for the chat operation to ops/chat-input/YYYY-MM-DD.md.
 *
 *   A  判定待ち            pending rows past max(target_date, confirmed) + 7 days
 *   B  前週の構成          the latest JP / US selection
 *   C  直近の signal       signals added since the previous export
 *   D  判定日の照合待ち    pending rows whose deadline is still the model's own
 *
 * Read-only on data/. No network, no API: this is the half of the loop that
 * replaced the Anthropic calls in Actions, and it must cost nothing to run.
 *
 *   node scripts/export-for-chat.mjs [--date YYYY-MM-DD] [--stdout]
 *
 * The answer comes back as JSON (ops/chat-schema.md) through
 * scripts/import-from-chat.mjs.
 */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  collectRows,
  judgeableFrom,
  weeksOf,
  CHAT_MODEL,
  GRACE_DAYS,
} from "./lib/chat-ops.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "ops", "chat-input");

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
}

export async function loadFiles() {
  return {
    usEvals: await readJson("data/portfolio-evaluations.json", { evaluations: [] }),
    usHistory: await readJson("data/portfolio-history.json", { current: null, history: [] }),
    jpEvals: await readJson("data/jp-portfolio-evaluations.json", { evaluations: [] }),
    jpHistory: await readJson("data/jp-portfolio-history.json", { current: null, history: [] }),
    externals: await readJson("data/external-catalysts.json", []),
    irFair: await readJson("data/ir-fair-2026-catalysts.json", { catalysts: [] }),
    signals: await readJson("data/signals.json", { signals: [] }),
  };
}

/** The most recent earlier export, by file name; null on the first run. */
export async function previousExportDate(today, dir = OUT_DIR) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const dates = names
    .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1])
    .filter((d) => d && d < today)
    .sort();
  return dates.at(-1) ?? null;
}

const cell = (v) =>
  v === null || v === undefined || v === ""
    ? "—"
    : String(v).replace(/\|/g, "／").replace(/\n+/g, " ");

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

/** Lines that help the judge without being part of the condition. */
function guideLines(row, all, rows) {
  const out = [];
  if (row.target_date_confirmed) {
    out.push(
      `会社公表日（照合済み）: ${row.target_date_confirmed}` +
        (row.target_date_confirmed_source ? `（${row.target_date_confirmed_source}）` : "") +
        ` — 判定はこの日以降の開示で行う`,
    );
  }
  out.push(`判定可能日: ${judgeableFrom(row.target_date, row.target_date_confirmed)}（期日＋${GRACE_DAYS}日）`);
  if (!row.target_date_confirmed) {
    // Another week's pick of the same company may have been reconciled against
    // the IR calendar already (6146: model said 10-15, the company said 10-22).
    // It is the same disclosure if the dates are close; say so, don't apply it.
    const near = rows.find(
      (r) =>
        r.kind === row.kind &&
        r.ticker === row.ticker &&
        r.target_date_confirmed &&
        Math.abs(Date.parse(r.target_date_confirmed) - Date.parse(row.target_date)) <= 30 * 864e5,
    );
    if (near) {
      out.push(
        `参考: 同社の別の週（${near.id}）で照合済みの公表日は ${near.target_date_confirmed}` +
          (near.target_date_confirmed_source ? `（${near.target_date_confirmed_source}）` : "") +
          `。この行の期日 ${row.target_date} が同じ開示を指すなら、判定はその公表内容で行う`,
      );
    }
  }
  if (row.thesis && row.thesis.trim() !== row.success_condition) {
    out.push(`選定時の thesis: ${row.thesis.trim()}`);
  }
  if (row.condition_source === "thesis") {
    out.push("条件は選定時の thesis そのもの（蒸留していない）。文中の数値・方向がそのまま基準。");
  }
  if (row.catalyst_type === "event") {
    out.push("イベント型: 期日までに成立を示す開示が確認できなければ miss（na ではない）。");
  }
  if (row.source && /^https?:/.test(row.source)) out.push(`条件の出典: ${row.source}`);
  // The same earnings release often backs several weeks' conditions (JPM ×3).
  // Each is judged on its own wording, but they share the evidence.
  const siblings = all.filter(
    (r) => r !== row && r.kind === row.kind && r.ticker === row.ticker && r.target_date === row.target_date,
  );
  if (siblings.length > 0) {
    out.push(
      `同じ開示を参照する行: ${siblings.map((s) => s.id).join(", ")}（条件の文言が違うので個別に判定）`,
    );
  }
  return out;
}

function holdingTable(p) {
  return table(
    ["ticker", "会社名", "比率", "条件", "target_date", "出所"],
    p.holdings.map((h) => [
      h.ticker,
      h.company_name,
      `${h.weight}%`,
      h.thesis,
      h.target_date,
      h.target_date_source ?? "未記録",
    ]),
  );
}

/**
 * Pure: everything the file says is derived from `files`, `today` and
 * `since`, so the export can be tested and reproduced.
 */
export function buildExport(files, { today, since }) {
  const rows = collectRows(files);

  const due = rows
    .filter(
      (r) =>
        r.status === "pending" &&
        r.target_date &&
        judgeableFrom(r.target_date, r.target_date_confirmed) <= today,
    )
    .sort((a, b) =>
      a.target_date === b.target_date
        ? a.id < b.id
          ? -1
          : 1
        : a.target_date < b.target_date
          ? -1
          : 1,
    );

  const unchecked = rows
    .filter(
      (r) =>
        (r.kind === "us" || r.kind === "jp") &&
        r.status === "pending" &&
        r.target_date &&
        !r.target_date_checked_at &&
        r.target_date_source !== "verified",
    )
    .sort((a, b) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : a.id < b.id ? -1 : 1));

  const signals = (files.signals?.signals ?? []).filter((s) => {
    if (!since) return true;
    // New to the record since the last export — by when it was added, not
    // when it was observed: a claim observed last week but imported today has
    // still not been seen.
    const at = String(s.added_at ?? s.observed_at ?? "").slice(0, 10);
    return at >= since;
  });

  const L = [];
  L.push(`# チャット運用 入力 ${today}`);
  L.push("");
  L.push(
    `生成: scripts/export-for-chat.mjs（${today}）。返答の形式は ops/chat-schema.md。` +
      `取り込みは scripts/import-from-chat.mjs。判定・選定の記録者は "${CHAT_MODEL}"。`,
  );
  L.push("");
  L.push("## 判定のルール（API 評価器と同じ）");
  L.push("");
  L.push("- 判定するのは **success_condition だけ**。fail_direction は背景で、その成否は判定しない。");
  L.push("- 本日（判定実施日）は上の日付。target_date は過去の日付として扱う。");
  L.push("- status は hit / partial / miss / na。na は「条件が判定できない書き方だった」「対象が消滅した」場合のみ。");
  L.push("- evidence_url は実際に開いた一次資料（決算短信・適時開示・IR・SEC）の URL。URL のない判定は取り込まれない。");
  L.push("");

  // ── A
  L.push(`## A. 判定待ち（${due.length}件）`);
  L.push("");
  L.push(`max(target_date, target_date_confirmed) + ${GRACE_DAYS}日 を過ぎた pending。`);
  L.push("");
  if (due.length === 0) {
    L.push("なし。");
  } else {
    L.push(
      table(
        ["id", "母集団", "ticker", "会社名", "target_date", "判定可能日"],
        due.map((r) => [
          r.id,
          r.population,
          r.ticker,
          r.company_name,
          r.target_date,
          judgeableFrom(r.target_date, r.target_date_confirmed),
        ]),
      ),
    );
    for (const r of due) {
      L.push("");
      L.push(`### ${r.id}`);
      L.push("");
      L.push(`- 母集団: ${r.population}`);
      L.push(`- ticker: ${r.ticker}`);
      L.push(`- 会社名: ${cell(r.company_name)}`);
      L.push(`- week_of: ${cell(r.week_of)}`);
      L.push(`- success_condition: ${r.success_condition}`);
      L.push(`- fail_direction: ${cell(r.fail_direction)}`);
      L.push(`- target_date: ${r.target_date}`);
      L.push(`- target_date_source: ${r.target_date_source}`);
      L.push("- 補助線:");
      for (const g of guideLines(r, due, rows)) L.push(`  - ${g}`);
    }
  }
  L.push("");

  // ── B
  L.push("## B. 前週の構成");
  L.push("");
  for (const [label, file] of [
    ["JP", files.jpHistory],
    ["US", files.usHistory],
  ]) {
    const p = weeksOf(file)[0];
    if (!p) {
      L.push(`### ${label}: 記録なし`);
      L.push("");
      continue;
    }
    L.push(`### ${label}（week_of ${p.week_of}・選定 ${cell(p.model)}）`);
    L.push("");
    const thisMonday = mondayOf(today);
    if (p.week_of < thisMonday) {
      const missing = [];
      for (let w = addDays(p.week_of, 7); w <= thisMonday; w = addDays(w, 7)) missing.push(w);
      L.push(`これが最新の選定。以後の週（${missing.join("、")}）は未選定。`);
      L.push("");
    }
    L.push(holdingTable(p));
    if (Array.isArray(p.excluded_holdings) && p.excluded_holdings.length > 0) {
      L.push("");
      L.push(
        `除外: ${p.excluded_holdings
          .map((x) => `${x.ticker}${x.company_name ? ` ${x.company_name}` : ""}（${x.reason ?? "除外"}）`)
          .join("、")}`,
      );
    }
    L.push("");
  }

  // ── C
  L.push(
    `## C. 直近の signal（${since ? `${since} の書き出し以降` : "初回の書き出しのため全件"}・${signals.length}件）`,
  );
  L.push("");
  L.push("「未検証」の signal は選定の根拠にしない（2026-10-17 以降の運用）。");
  L.push("");
  if (signals.length === 0) {
    L.push("なし。");
  } else {
    L.push(
      table(
        ["id", "検証", "claim", "tickers", "source_tier", "出典", "observed_at"],
        signals.map((s) => [
          s.id,
          s.verified === true ? "検証済み" : "未検証",
          s.claim,
          (s.tickers ?? []).join(", "),
          s.source_tier,
          s.source_url ?? s.source,
          String(s.observed_at ?? s.added_at ?? "").slice(0, 10),
        ]),
      ),
    );
  }
  L.push("");

  // ── D
  // One line per company disclosure, not per row: the same model date is
  // usually repeated across several weeks' picks of the same company, and
  // checking it once settles all of them.
  const events = new Map();
  for (const r of unchecked) {
    const k = `${r.kind}:${r.ticker}:${r.target_date}`;
    if (!events.has(k)) events.set(k, { first: r, ids: [] });
    events.get(k).ids.push(r.id);
  }
  L.push(`## D. 判定日の照合待ち（${events.size}件の開示・${unchecked.length}行）`);
  L.push("");
  L.push(
    "target_date_source が model か未記録（選定モデル自身の日付のまま、会社の公表日と未照合）の pending。" +
      "会社の公表日が分かったら date_checks として返す（ops/chat-schema.md）。target_date 自体は書き換えない。",
  );
  L.push("");
  if (events.size === 0) {
    L.push("なし。");
  } else {
    L.push(
      table(
        ["市場", "ticker", "会社名", "target_date（model）", "判定可能日", "状態", "該当行"],
        [...events.values()].map(({ first: r, ids }) => {
          const from = judgeableFrom(r.target_date, r.target_date_confirmed);
          return [
            r.kind.toUpperCase(),
            r.ticker,
            r.company_name,
            r.target_date,
            from,
            from <= today ? "判定待ち（A）" : r.target_date <= today ? "猶予中" : "未到来",
            ids.join(", "),
          ];
        }),
      ),
    );
  }
  L.push("");

  return { markdown: L.join("\n"), counts: { due: due.length, signals: signals.length, unchecked: unchecked.length, events: events.size }, due };
}

/** Monday of the week containing `iso` (UTC date arithmetic; dates only). */
export function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf("--date");
  const today = di >= 0 ? args[di + 1] : todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) {
    console.error("usage: export-for-chat.mjs [--date YYYY-MM-DD] [--stdout]");
    process.exit(2);
  }
  const files = await loadFiles();
  const since = await previousExportDate(today);
  const { markdown, counts } = buildExport(files, { today, since });
  if (args.includes("--stdout")) {
    process.stdout.write(markdown);
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${today}.md`);
  await writeFile(out, markdown, "utf8");
  console.log(
    `[export] ${path.relative(ROOT, out)}: A ${counts.due} 判定待ち · C ${counts.signals} signal · D ${counts.events} 開示（${counts.unchecked} 行）照合待ち`,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[export] failed: ${e.message}`);
    process.exit(1);
  });
}
