#!/usr/bin/env node
/**
 * Read a chat answer back into data/ and commit it.
 *
 *   npm run import:chat -- <answer.json> [--dry-run] [--no-commit]
 *
 * One JSON file, one type, one commit. The types and every rule are in
 * ops/chat-schema.md; this file is the enforcement of that page:
 *
 *   selection    a new week's JP or US book. Passes the JPX listing screen
 *                (JP); never replaces a week that is already on record.
 *   verdicts     hit/partial/miss/na for rows the export listed. No URL, no
 *                verdict. A judged row is only re-judged with a stated reason,
 *                and its old verdict moves to verdict_history.
 *   signals      claims with a source URL. verified:false is kept, and the
 *                export marks it 未検証.
 *   date_checks  the company's own disclosure date for rows whose deadline is
 *                still the model's. Never moves target_date.
 *   theme_catalysts  a theme's next conditions (ops/chat-schema.md §5).
 *   metrics      neocloud business numbers, one row per disclosed number, each
 *                with its document URL. No estimates; undisclosed is null.
 *
 * No network, no API. Runs under tsx (`node --import tsx`) so it can reuse the
 * listing screen and the week-over-week diff from lib/ rather than copy them.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_MODEL,
  collectRows,
  judgeableFrom,
  parseRowId,
  validateSuccessConditions,
  vagueWithoutNumber,
  weeksOf,
} from "./lib/chat-ops.mjs";
import { excludeDelisted } from "../lib/listing-status.ts";
import { diffHoldings, MAX_HOLDING_WEIGHT } from "../lib/portfolio.ts";
import { themesFor } from "../lib/themes.ts";
import { METRIC_ITEMS, MONEY_UNITS, POWER_ITEMS, neocloudCompanies } from "../lib/neocloud.ts";
import { createHash } from "node:crypto";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(["hit", "partial", "miss", "na"]);
const TIERS = new Set(["primary", "secondary", "opinion", "leak"]);
const DIRECTIONS = new Set(["bullish", "bearish", "structural"]);
const JP_CODE = /^[0-9][0-9A-Z]{3}$/; // 4 digits, or the newer 3-digit+letter codes (e.g. 593A)
const US_CODE = /^[A-Z][A-Z.\-]{0,6}$/;
const PORTFOLIO_MAX = 10;

/** Paths, relative to the repo root, of everything an import may write. */
export const FILES = {
  usEvals: "data/portfolio-evaluations.json",
  usHistory: "data/portfolio-history.json",
  jpEvals: "data/jp-portfolio-evaluations.json",
  jpHistory: "data/jp-portfolio-history.json",
  externals: "data/external-catalysts.json",
  irFair: "data/ir-fair-2026-catalysts.json",
  signals: "data/signals.json",
  eras: "data/operation-eras.json",
  listed: "data/jp-listed.json",
  themes: "data/themes.json",
  neocloudMetrics: "data/neocloud-metrics.json",
};

const isUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s]+\.[^\s]+/.test(u);
const isIsoTime = (t) => typeof t === "string" && !Number.isNaN(Date.parse(t)) && /^\d{4}-\d{2}-\d{2}T/.test(t);
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const isMonday = (d) => ISO_DATE.test(d) && new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
const round1 = (n) => Math.round(n * 10) / 10;

export const EMPTY_ERAS = {
  note:
    "When selection and judging moved from the Anthropic API in Actions to the chat operation " +
    "(scripts/export-for-chat.mjs → chat → scripts/import-from-chat.mjs). Written by the importer " +
    "on the first import of each kind and never moved afterwards. Rows from weeks on or after " +
    "selection_chat_from[market] were picked in chat and are a separate population from the API weeks.",
  selection_chat_from: { US: null, JP: null },
  verdicts_chat_from: null,
};

// ── selection ─────────────────────────────────────────────────────────────

function importSelection(p, files, ctx) {
  const errors = [];
  const market = p.market;
  if (market !== "JP" && market !== "US") errors.push(`market must be "JP" or "US"`);
  if (p.model !== CHAT_MODEL) errors.push(`model must be "${CHAT_MODEL}"`);
  if (!isMonday(p.week_of)) errors.push(`week_of must be a Monday (YYYY-MM-DD)`);
  if (!nonEmpty(p.rationale)) errors.push("rationale is required");
  if (typeof p.used_external_data !== "boolean") errors.push("used_external_data (boolean) is required");
  const holdings = Array.isArray(p.holdings) ? p.holdings : [];
  if (holdings.length === 0 || holdings.length > PORTFOLIO_MAX) {
    errors.push(`holdings must have 1–${PORTFOLIO_MAX} rows`);
  }
  if (errors.length) return { errors };

  const historyKey = market === "JP" ? "jpHistory" : "usHistory";
  const history = files[historyKey] ?? { current: null, history: [] };
  const latest = weeksOf(history)[0];
  if (weeksOf(history).some((w) => w.week_of === p.week_of)) {
    errors.push(`${market} ${p.week_of} is already on record; a published week is never replaced`);
  } else if (latest && p.week_of < latest.week_of) {
    errors.push(`${market} ${p.week_of} is older than the latest week on record (${latest.week_of})`);
  }

  const seen = new Set();
  const clean = [];
  for (const [i, h] of holdings.entries()) {
    const at = `holdings[${i}]`;
    const ticker = String(h?.ticker ?? "").trim().toUpperCase();
    if (!(market === "JP" ? JP_CODE : US_CODE).test(ticker)) errors.push(`${at}: bad ticker "${h?.ticker}"`);
    if (seen.has(ticker)) errors.push(`${at}: duplicate ticker ${ticker}`);
    seen.add(ticker);
    if (!nonEmpty(h?.company_name)) errors.push(`${at}: company_name is required`);
    if (!(Number.isFinite(h?.weight) && h.weight > 0)) errors.push(`${at}: weight must be > 0`);
    if (market === "US" && h?.weight > MAX_HOLDING_WEIGHT) {
      errors.push(`${at}: ${ticker} weight ${h.weight} exceeds the US cap of ${MAX_HOLDING_WEIGHT}`);
    }
    if (!nonEmpty(h?.thesis)) errors.push(`${at}: thesis (the condition) is required`);
    const vague = vagueWithoutNumber(h?.thesis);
    if (vague.length) {
      errors.push(`${at}: thesis uses vague wording (${vague.join("・")}) with no numeric threshold`);
    }
    errors.push(...validateSuccessConditions(h?.success_conditions, at));
    const themeIds = new Set((files.themes?.themes ?? []).map((t) => t.id));
    if (h?.themes !== undefined) {
      if (!Array.isArray(h.themes) || h.themes.some((t) => !themeIds.has(t))) {
        errors.push(`${at}: themes must be ids from data/themes.json`);
      }
    }
    if (!ISO_DATE.test(h?.target_date ?? "")) errors.push(`${at}: target_date must be YYYY-MM-DD`);
    else if (h.target_date < p.week_of) errors.push(`${at}: target_date ${h.target_date} is before week_of`);
    if (h?.target_date_source !== "model" && h?.target_date_source !== "verified") {
      errors.push(`${at}: target_date_source must be "model" or "verified"`);
    }
    if (h?.target_date_source === "verified" && !isUrl(h?.target_date_source_url)) {
      errors.push(`${at}: a verified target_date needs target_date_source_url (the IR page)`);
    }
    const row = {
      ticker,
      company_name: String(h?.company_name ?? "").trim(),
      weight: h?.weight,
      thesis: String(h?.thesis ?? "").trim(),
      target_date: h?.target_date,
      target_date_source: h?.target_date_source,
      success_conditions: (Array.isArray(h?.success_conditions) ? h.success_conditions : []).map((c) => ({
        metric: String(c?.metric ?? "").trim(),
        operator: c?.operator,
        threshold: { value: c?.threshold?.value, unit: String(c?.threshold?.unit ?? "").trim() },
        source_doc: String(c?.source_doc ?? "").trim(),
      })),
    };
    // Every pick carries the themes it belongs to: the ones named in the
    // answer plus the ones its ticker is already a member of.
    row.themes = [
      ...new Set([
        ...(Array.isArray(h?.themes) ? h.themes : []),
        ...themesFor(ticker, files.themes, recordsOf(files)).filter((t) => !t.startsWith("weekly-")),
      ]),
    ];
    if (h?.target_date_source === "verified") {
      row.target_date_confirmed_source = h.target_date_source_url;
      row.target_date_checked_at = ctx.today;
    }
    clean.push(row);
  }
  const sum = holdings.reduce((n, h) => n + (Number(h?.weight) || 0), 0);
  if (Math.abs(sum - 100) > 0.5) errors.push(`weights sum to ${round1(sum)}, not 100`);
  if (errors.length) return { errors };

  // The listing screen (JP). Same code path as the API selection used.
  let kept = clean;
  let excluded = [];
  const notes = [];
  if (market === "JP") {
    if (!ctx.listed?.listed) {
      return { errors: [`${FILES.listed} is missing; a JP selection cannot be imported unscreened`] };
    }
    const screened = excludeDelisted(clean, ctx.listed);
    kept = screened.kept;
    excluded = screened.dropped.map((d) => ({
      ticker: d.ticker,
      company_name: d.company_name ?? null,
      original_weight: clean.find((c) => c.ticker === d.ticker)?.weight ?? null,
      excluded_at: ctx.today,
      reason: d.reason,
    }));
    for (const x of excluded) notes.push(`excluded ${x.ticker} ${x.company_name ?? ""} — ${x.reason}`);
    if (kept.length === 0) return { errors: ["every pick failed the listing screen"] };
  }

  const portfolio = {
    week_of: p.week_of,
    generated_at: isIsoTime(p.generated_at) ? p.generated_at : ctx.now,
    model: CHAT_MODEL,
    horizon: nonEmpty(p.horizon) ? p.horizon : "1m",
    rationale: p.rationale.trim(),
    holdings: kept,
    changes: diffHoldings(latest ?? null, { holdings: kept }),
    used_external_data: p.used_external_data,
    external_source: p.used_external_data ? (p.external_source ?? null) : null,
    external_fetched_at: null,
    ...(excluded.length ? { excluded_holdings: excluded } : {}),
  };
  const prev = files[historyKey];
  const nextHistory = {
    ...prev,
    updated_at: ctx.now,
    current: portfolio,
    history: prev?.current ? [prev.current, ...(prev.history ?? [])] : prev?.history ?? [],
  };

  // Register the new rows as pending right away — the API evaluator used to do
  // this on its next run, and there is no next run any more.
  const evalsKey = market === "JP" ? "jpEvals" : "usEvals";
  const evals = structuredClone(files[evalsKey] ?? { evaluations: [] });
  for (const h of kept) {
    evals.evaluations.push({
      week_of: p.week_of,
      ticker: h.ticker,
      catalyst_target_date: h.target_date,
      success_condition: h.thesis,
      success_conditions: h.success_conditions,
      condition_source: "thesis",
      status: "pending",
      evaluated_at: null,
      evidence_url: null,
      reasoning: null,
    });
  }
  evals.updated_at = ctx.now;

  const eras = structuredClone(files.eras ?? EMPTY_ERAS);
  eras.selection_chat_from ??= { US: null, JP: null };
  if (!eras.selection_chat_from[market]) {
    eras.selection_chat_from[market] = p.week_of;
    notes.push(`recorded ${market} chat-selection start: ${p.week_of}`);
  }

  return {
    writes: { [historyKey]: nextHistory, [evalsKey]: evals, eras },
    applied: kept.length,
    rejected: [],
    notes,
    label: `${market} ${p.week_of} ${kept.length}銘柄`,
  };
}

// ── verdicts ──────────────────────────────────────────────────────────────

const FILE_OF_KIND = { us: "usEvals", jp: "jpEvals", ext: "externals", irf: "irFair" };

function importVerdicts(p, files, ctx) {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { errors: ["items is empty"] };

  // Work on copies; collectRows hands back references into these.
  const work = {
    usEvals: structuredClone(files.usEvals),
    usHistory: files.usHistory,
    jpEvals: structuredClone(files.jpEvals),
    jpHistory: files.jpHistory,
    externals: structuredClone(files.externals),
    irFair: structuredClone(files.irFair),
  };
  const byId = new Map(collectRows(work).map((r) => [r.id, r]));
  const touched = new Set();
  const rejected = [];
  const seen = new Set();
  let applied = 0;

  for (const [i, v] of items.entries()) {
    const id = v?.id;
    const why = [];
    const row = byId.get(id);
    if (!parseRowId(id) || !row) why.push("unknown id");
    if (seen.has(id)) why.push("duplicate id in this file");
    if (!STATUSES.has(v?.status)) why.push(`status must be one of ${[...STATUSES].join("/")}`);
    if (!nonEmpty(v?.reasoning)) why.push("reasoning is required");
    if (!isUrl(v?.evidence_url)) why.push("evidence_url is required (a judgement without a source is not imported)");
    if (!isIsoTime(v?.evaluated_at)) why.push("evaluated_at must be an ISO timestamp");
    if (v?.evaluator !== CHAT_MODEL) why.push(`evaluator must be "${CHAT_MODEL}"`);
    if (row) {
      if (row.status === "excluded") why.push("row is excluded (left the population before judging)");
      const from = judgeableFrom(row.target_date, row.target_date_confirmed);
      if (isIsoTime(v?.evaluated_at) && v.evaluated_at.slice(0, 10) < from) {
        why.push(`too early: judgeable from ${from}`);
      }
      if (row.status !== "pending" && row.status !== "excluded" && !nonEmpty(v?.revision_reason)) {
        why.push(`already judged (${row.status}); re-judging needs revision_reason`);
      }
    }
    seen.add(id);
    if (why.length) {
      rejected.push({ index: i, id: id ?? null, reasons: why });
      continue;
    }

    const e = row.ref;
    const day = v.evaluated_at.slice(0, 10);
    if (row.status !== "pending") {
      // Never overwrite: the old verdict goes to verdict_history first.
      e.verdict_history = [
        ...(Array.isArray(e.verdict_history) ? e.verdict_history : []),
        {
          status: e.status,
          judgement_date: e.judgement_date ?? (e.evaluated_at ? String(e.evaluated_at).slice(0, 10) : null),
          evidence_url: e.evidence_url ?? (Array.isArray(e.evidence_urls) ? e.evidence_urls[0] ?? null : null),
          reasoning: e.reasoning ?? null,
          evaluator: e.evaluator ?? null,
          changed_at: ctx.today,
          change_reason: v.revision_reason.trim(),
        },
      ];
      e.verdict_revised_at = ctx.today;
    }
    e.status = v.status;
    e.reasoning = v.reasoning.trim();
    e.evaluator = CHAT_MODEL;
    e.evaluated_at = v.evaluated_at;
    if (row.kind === "ext") {
      e.evidence_urls = [v.evidence_url];
      e.judgement_date = day;
    } else {
      e.evidence_url = v.evidence_url;
      if (row.kind === "irf") e.judgement_date = day;
    }
    touched.add(FILE_OF_KIND[row.kind]);
    applied += 1;
  }

  const writes = {};
  for (const k of touched) {
    if (k === "externals") writes[k] = work[k];
    else writes[k] = { ...work[k], updated_at: ctx.now };
  }
  const notes = [];
  if (applied > 0) {
    const eras = structuredClone(files.eras ?? EMPTY_ERAS);
    if (!eras.verdicts_chat_from) {
      eras.verdicts_chat_from = ctx.today;
      writes.eras = eras;
      notes.push(`recorded chat-judging start: ${ctx.today}`);
    }
  }
  return { writes, applied, rejected, notes, label: `${applied}件` };
}

// ── signals ───────────────────────────────────────────────────────────────

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function importSignals(p, files, ctx) {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { errors: ["items is empty"] };
  const file = structuredClone(files.signals ?? { source: "signals", note: "", signals: [] });
  const ids = new Set(file.signals.map((s) => s.id));
  const rejected = [];
  let applied = 0;
  for (const [i, s] of items.entries()) {
    const why = [];
    if (!nonEmpty(s?.claim)) why.push("claim is required");
    if (!isUrl(s?.source_url)) why.push("source_url is required");
    if (!TIERS.has(s?.source_tier)) why.push(`source_tier must be one of ${[...TIERS].join("/")}`);
    if (typeof s?.verified !== "boolean") why.push("verified (boolean) is required");
    if (!Array.isArray(s?.tickers)) why.push("tickers (array, may be empty) is required");
    if (!ISO_DATE.test(s?.observed_at ?? "")) why.push("observed_at must be YYYY-MM-DD");
    if (s?.direction !== undefined && !DIRECTIONS.has(s.direction)) {
      why.push(`direction must be one of ${[...DIRECTIONS].join("/")}`);
    }
    const id = nonEmpty(s?.id)
      ? s.id
      : `sig_${s?.observed_at?.replace(/-/g, "") ?? "x"}_${slug((s?.tickers ?? []).join("_") || s?.source_tier || "x")}`;
    let uid = id;
    for (let n = 2; ids.has(uid); n += 1) uid = `${id}_${n}`;
    if (nonEmpty(s?.id) && ids.has(s.id)) why.push(`id ${s.id} already exists`);
    if (why.length) {
      rejected.push({ index: i, id: s?.id ?? null, reasons: why });
      continue;
    }
    ids.add(uid);
    file.signals.push({
      id: uid,
      claim: s.claim.trim(),
      ...(nonEmpty(s.basis) ? { basis: s.basis.trim() } : {}),
      direction: s.direction ?? "structural",
      scope: nonEmpty(s.scope) ? s.scope : s.tickers.join(",") || "market",
      tickers: s.tickers.map((t) => String(t).toUpperCase()),
      source: s.source_url,
      source_url: s.source_url,
      source_tier: s.source_tier,
      verified: s.verified,
      // Context unless the chat said otherwise: a signal is never scored by
      // default, and an unverified one never is (lib/signals.ts).
      judgeability: s.judgeability ?? "context",
      observed_at: s.observed_at,
      added_at: ctx.now,
      added_by: CHAT_MODEL,
    });
    applied += 1;
  }
  file.updated_at = ctx.now;
  return {
    writes: applied ? { signals: file } : {},
    applied,
    rejected,
    notes: [],
    label: `${applied}件`,
  };
}

// ── date_checks ───────────────────────────────────────────────────────────

function importDateChecks(p, files, ctx) {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { errors: ["items is empty"] };
  const work = { usHistory: structuredClone(files.usHistory), jpHistory: structuredClone(files.jpHistory) };
  const touched = new Set();
  const rejected = [];
  let applied = 0;
  for (const [i, c] of items.entries()) {
    const why = [];
    const ids = Array.isArray(c?.ids) ? c.ids : [];
    if (ids.length === 0) why.push("ids is required");
    if (!ISO_DATE.test(c?.confirmed_date ?? "")) why.push("confirmed_date must be YYYY-MM-DD");
    if (!isUrl(c?.source_url)) why.push("source_url (the IR page) is required");
    const targets = [];
    for (const id of ids) {
      const r = parseRowId(id);
      if (!r || (r.kind !== "us" && r.kind !== "jp")) {
        why.push(`${id}: only us:/jp: rows carry a model deadline`);
        continue;
      }
      const key = r.kind === "jp" ? "jpHistory" : "usHistory";
      const week = weeksOf(work[key]).find((w) => w.week_of === r.week_of);
      const h = week?.holdings.find((x) => String(x.ticker).toUpperCase() === r.ticker);
      if (!h) why.push(`${id}: no such holding`);
      else targets.push({ key, h });
    }
    if (why.length) {
      rejected.push({ index: i, id: ids.join(",") || null, reasons: why });
      continue;
    }
    for (const { key, h } of targets) {
      // target_date itself is never moved: the condition was fixed when it was
      // published. The company's date sits beside it, and the scorer waits for
      // the later of the two.
      h.target_date_source = "verified";
      h.target_date_checked_at = ctx.today;
      h.target_date_confirmed_source = c.source_url;
      h.target_date_confirmed = c.confirmed_date !== h.target_date ? c.confirmed_date : null;
      touched.add(key);
      applied += 1;
    }
  }
  const writes = {};
  for (const k of touched) writes[k] = { ...work[k], updated_at: ctx.now };
  return { writes, applied, rejected, notes: [], label: `${applied}行` };
}

// ── theme_catalysts ───────────────────────────────────────────────────────

/** The records shape lib/ reads, from the importer's files. */
function recordsOf(files) {
  return {
    usHistory: files.usHistory ?? null,
    usEvals: files.usEvals ?? null,
    jpHistory: files.jpHistory ?? null,
    jpEvals: files.jpEvals ?? null,
    externals: files.externals ?? [],
    irFair: files.irFair ?? null,
    signals: null,
  };
}

const THEME_AUTHORS = new Set([CHAT_MODEL, "article"]);
const DATE_CONFIDENCE = new Set(["confirmed", "estimated"]);

/** Same theme, ticker, deadline and wording → the same id, so a resend is a no-op. */
export function themeCatalystId(theme, ticker, targetDate, question) {
  const h = createHash("sha256").update(`${theme}|${ticker}|${targetDate}|${question}`).digest("hex");
  return `ext_${h.slice(0, 8)}`;
}

/**
 * New dated catalysts for a theme's members. Stored beside the Physical AI
 * series in data/external-catalysts.json with `series` = the theme id, so the
 * chat judges them like every other ext row and /api/themes/{theme} and
 * /api/catalyst/{ticker} serve them the moment they are written. Each item
 * must carry the structured success conditions (metric / operator / threshold
 * / source_doc). Bad items are listed and skipped; the rest are imported.
 */
function importThemeCatalysts(p, files, ctx) {
  if (!THEME_AUTHORS.has(p.author)) {
    return { errors: [`author must be "${CHAT_MODEL}" or "article"`] };
  }
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { errors: ["items must be a non-empty array"] };
  const themeIds = new Set((files.themes?.themes ?? []).map((t) => t.id));
  const list = structuredClone(files.externals ?? []);
  const known = new Set(list.map((c) => c.catalyst_id));
  const rejected = [];
  const idByIndex = new Map();
  let applied = 0;
  for (const [i, it] of items.entries()) {
    const at = `items[${i}]`;
    const reasons = [];
    const market = it?.market;
    const ticker = String(it?.ticker ?? "").trim().toUpperCase();
    const listed = it?.listed !== false;
    if (!themeIds.has(it?.theme)) reasons.push(`theme "${it?.theme}" is not in data/themes.json`);
    if (market !== "US" && market !== "JP") reasons.push(`market must be "US" or "JP"`);
    if (listed && !(market === "JP" ? JP_CODE : US_CODE).test(ticker)) reasons.push(`bad ticker "${it?.ticker}"`);
    if (!listed && !/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(ticker)) reasons.push(`unlisted ticker must be an uppercase slug`);
    if (!nonEmpty(it?.company_name)) reasons.push("company_name is required");
    if (!nonEmpty(it?.question)) reasons.push("question is required");
    // A past edition's condition is recorded as it was published (history):
    // it is not a new condition, so the 2026-11-05 wording rules do not apply,
    // and it must say which condition replaced it, if any.
    const history = it?.history === true;
    if (history && p.author !== "article") reasons.push(`history items come from articles (author "article")`);
    if (!history) {
      const vague = vagueWithoutNumber(it?.question);
      if (vague.length) reasons.push(`question uses vague wording (${vague.join("・")}) with no numeric threshold`);
      reasons.push(...validateSuccessConditions(it?.success_conditions, at).map((e) => e.replace(`${at}: `, "")));
    }
    if (it?.superseded_by != null && !known.has(it.superseded_by)) {
      reasons.push(`superseded_by ${it.superseded_by} is not on record`);
    }
    if (it?.supersedes != null && !known.has(it.supersedes)) reasons.push(`supersedes ${it.supersedes} is not on record`);
    if (!ISO_DATE.test(it?.target_date ?? "")) reasons.push("target_date must be YYYY-MM-DD");
    if (!DATE_CONFIDENCE.has(it?.date_confidence)) reasons.push(`date_confidence must be "confirmed" or "estimated"`);
    if (!isUrl(it?.source_url)) reasons.push("source_url (where the catalyst was published) is required");
    const role = it?.role ?? "main";
    if (role !== "main" && role !== "sub") reasons.push(`role must be "main" or "sub"`);
    const parent = role === "sub" ? idByIndex.get(it?.parent_index) : null;
    if (role === "sub" && !parent) reasons.push("a sub needs parent_index pointing at an accepted main item above it");
    const question = String(it?.question ?? "").trim();
    const id = themeCatalystId(it?.theme, ticker, it?.target_date, question);
    if (known.has(id)) reasons.push("already on record");
    if (reasons.length) {
      rejected.push({ index: i, id: `${it?.theme}:${ticker}`, reasons });
      continue;
    }
    const fail = nonEmpty(it?.fail_direction) ? String(it.fail_direction).trim() : null;
    list.push({
      catalyst_id: id,
      ticker,
      market,
      source: `theme:${it.theme}`,
      source_url: it.source_url,
      conviction: null,
      agent_id: null,
      catalyst_description: fail ? `${question}【外れ方向】${fail}` : question,
      success_conditions: (Array.isArray(it.success_conditions) ? it.success_conditions : []).map((c) => ({
        metric: String(c.metric).trim(),
        operator: c.operator,
        threshold: { value: c.threshold.value, unit: String(c.threshold.unit).trim() },
        source_doc: String(c.source_doc).trim(),
      })),
      target_date: it.target_date,
      submitted_at: ctx.now,
      submitter_contact: null,
      status: "pending",
      judgement_date: null,
      evidence_urls: [],
      reasoning: null,
      catalyst_type: it.catalyst_type === "earnings" ? "earnings" : it.date_confidence === "confirmed" ? "fixed_date" : "event",
      date_confidence: it.date_confidence,
      country: market,
      series: it.theme,
      catalyst_role: role,
      parent_catalyst_id: parent,
      company_name: String(it.company_name).trim(),
      ...(listed ? {} : { unlisted: true }),
      author: p.author,
      ...(history ? { edition: "history" } : {}),
      ...(it.superseded_by != null ? { superseded_by: it.superseded_by, superseded_at: ctx.today } : {}),
      ...(nonEmpty(it.superseded_reason) ? { superseded_reason: String(it.superseded_reason).trim() } : {}),
      ...(nonEmpty(it.article_verdict) ? { article_verdict: String(it.article_verdict).trim() } : {}),
    });
    // A new edition's condition replaces an older one: the old row keeps its
    // text and result and gains a pointer to its replacement.
    if (it.supersedes != null) {
      const old = list.find((c) => c.catalyst_id === it.supersedes);
      if (old && !old.superseded_by) Object.assign(old, { superseded_by: id, superseded_at: ctx.today });
    }
    known.add(id);
    idByIndex.set(i, id);
    applied += 1;
  }
  if (applied === 0) return { errors: rejected.map((r) => `items[${r.index}]: ${r.reasons.join("; ")}`) };
  const byTheme = {};
  for (const c of list.slice(list.length - applied)) byTheme[c.series] = (byTheme[c.series] ?? 0) + 1;
  return {
    writes: { externals: list },
    applied,
    rejected,
    notes: Object.entries(byTheme).map(([t, n]) => `${t}: ${n}件`),
    label: Object.entries(byTheme).map(([t, n]) => `${t} ${n}件`).join("・"),
  };
}

// ── entry ─────────────────────────────────────────────────────────────────

// ── metrics (neocloud) ────────────────────────────────────────────────────

const GUIDANCE_ITEMS = new Set(["revenue_guidance", "capex_guidance"]);
const ESTIMATE_KEYS = ["estimate", "estimated", "estimation", "approx", "approximate", "assumed"];
const finiteOrNull = (v) => v === null || (typeof v === "number" && Number.isFinite(v));

export function metricId(r) {
  const key = [
    r.ticker,
    r.item,
    r.as_of,
    r.source_url,
    r.period ?? "",
    r.detail?.instrument ?? r.detail?.counterparty ?? "",
    r.detail?.name ?? "",
  ].join("|");
  return `nm_${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
}

export const EMPTY_METRICS = {
  note:
    "Neocloud business numbers, one row per number a document discloses (company · item · value · unit · as_of · " +
    "source_url · published_at). Written by scripts/import-from-chat.mjs (type metrics). No estimates: a number " +
    "the document does not state is value null, or no row. Money is the full amount in USD or JPY; power is MW.",
  updated_at: null,
  metrics: [],
};

function importMetrics(p, files, ctx) {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return { errors: ["items is empty"] };
  const companies = new Map(neocloudCompanies(files.themes).map((c) => [c.ticker, c]));
  if (companies.size === 0) return { errors: ["data/themes.json has no neocloud members"] };
  const file = structuredClone(files.neocloudMetrics ?? EMPTY_METRICS);
  const ids = new Set(file.metrics.map((r) => r.id));
  const rejected = [];
  const byItem = {};
  const tickers = new Set();
  let applied = 0;
  for (const [i, m] of items.entries()) {
    const why = [];
    const ticker = String(m?.ticker ?? "").trim().toUpperCase();
    const c = companies.get(ticker);
    if (!c) why.push(`ticker ${ticker || "(empty)"} is not a neocloud member`);
    if (!METRIC_ITEMS.includes(m?.item)) why.push(`item must be one of ${METRIC_ITEMS.join("/")}`);
    const power = POWER_ITEMS.includes(m?.item);
    if (power && m?.unit !== "MW") why.push("unit must be MW for a power item");
    if (!power && !MONEY_UNITS.includes(m?.unit)) why.push(`unit must be ${MONEY_UNITS.join(" or ")} (full amount)`);
    if (!("value" in (m ?? {})) || !finiteOrNull(m.value)) why.push("value must be a number, or null when not disclosed");
    for (const k of ["low", "high"]) if (m?.[k] !== undefined && !finiteOrNull(m[k])) why.push(`${k} must be a number`);
    for (const k of ["value", "low", "high"]) if (typeof m?.[k] === "number" && m[k] < 0) why.push(`${k} is negative`);
    if (ESTIMATE_KEYS.some((k) => m?.[k] !== undefined && m[k] !== false) || m?.source_tier === "estimate") {
      why.push("estimates are not recorded");
    }
    if (GUIDANCE_ITEMS.has(m?.item) && !nonEmpty(m?.period)) why.push("period is required for guidance (e.g. FY2026)");
    const stated = m?.value !== null || m?.low != null || m?.high != null;
    if (m?.item === "financing" && stated && !nonEmpty(m?.detail?.instrument)) {
      why.push("detail.instrument is required for financing");
    }
    if (m?.item === "key_contracts" && (stated || m?.detail) && !nonEmpty(m?.detail?.counterparty)) {
      why.push("detail.counterparty is required for key_contracts (write 非開示 when unnamed)");
    }
    if (m?.detail !== undefined && m.detail !== null && (typeof m.detail !== "object" || Array.isArray(m.detail))) {
      why.push("detail must be an object");
    }
    if (!isUrl(m?.source_url)) why.push("source_url is required");
    if (!ISO_DATE.test(m?.as_of ?? "")) why.push("as_of must be YYYY-MM-DD");
    if (!ISO_DATE.test(m?.published_at ?? "")) why.push("published_at must be YYYY-MM-DD");
    if (ISO_DATE.test(m?.published_at ?? "") && m.published_at > ctx.today) why.push("published_at is in the future");
    if (ISO_DATE.test(m?.as_of ?? "") && ISO_DATE.test(m?.published_at ?? "") && m.as_of > m.published_at) {
      why.push("as_of is after published_at");
    }
    const row = {
      ticker,
      market: c?.market ?? null,
      item: m?.item,
      value: m?.value ?? null,
      unit: m?.unit,
      as_of: m?.as_of,
      ...(nonEmpty(m?.period) ? { period: m.period.trim() } : {}),
      ...(typeof m?.low === "number" ? { low: m.low } : {}),
      ...(typeof m?.high === "number" ? { high: m.high } : {}),
      ...(m?.detail && typeof m.detail === "object" ? { detail: m.detail } : {}),
      source_url: m?.source_url,
      published_at: m?.published_at,
      ...(nonEmpty(m?.note) ? { note: m.note.trim() } : {}),
    };
    const id = why.length ? null : metricId(row);
    if (id && ids.has(id)) why.push(`already recorded (${id})`);
    if (why.length) {
      rejected.push({ index: i, id: ticker ? `${ticker}:${m?.item ?? "?"}` : null, reasons: why });
      continue;
    }
    ids.add(id);
    file.metrics.push({ id, ...row, added_at: ctx.now, added_by: CHAT_MODEL });
    byItem[row.item] = (byItem[row.item] ?? 0) + 1;
    tickers.add(ticker);
    applied += 1;
  }
  file.updated_at = ctx.now;
  const perItem = METRIC_ITEMS.filter((k) => byItem[k]).map((k) => `${k} ${byItem[k]}`);
  return {
    writes: applied ? { neocloudMetrics: file } : {},
    applied,
    rejected,
    notes: [`${tickers.size}社: ${[...tickers].join(", ")}`, `項目別: ${perItem.join("・") || "なし"}`],
    label: `${applied}行・${tickers.size}社`,
  };
}

const HANDLERS = {
  selection: importSelection,
  verdicts: importVerdicts,
  signals: importSignals,
  date_checks: importDateChecks,
  theme_catalysts: importThemeCatalysts,
  metrics: importMetrics,
};

/**
 * Pure: validate `payload` against `files` and return what would be written.
 * `{ errors }` means nothing is written at all.
 */
export function planImport(payload, files, ctx) {
  const handler = HANDLERS[payload?.type];
  if (!handler) {
    return { errors: [`type must be one of ${Object.keys(HANDLERS).join(", ")}`] };
  }
  return { type: payload.type, ...handler(payload, files, ctx) };
}

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await readFile(rel, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const noCommit = args.includes("--no-commit");
  if (!input) {
    console.error("usage: npm run import:chat -- <answer.json> [--dry-run] [--no-commit]");
    process.exit(2);
  }
  const payload = JSON.parse(await readFile(input, "utf8"));
  const files = {};
  for (const [k, rel] of Object.entries(FILES)) {
    files[k] = await readJson(rel, k === "externals" ? [] : null);
  }
  const now = new Date().toISOString();
  const plan = planImport(payload, files, { now, today: now.slice(0, 10), listed: files.listed });

  if (plan.errors) {
    for (const e of plan.errors) console.error(`::error::${e}`);
    console.error("[import] rejected — nothing written");
    process.exit(1);
  }
  for (const r of plan.rejected) {
    console.error(`::warning::item ${r.index}${r.id ? ` (${r.id})` : ""}: ${r.reasons.join("; ")}`);
  }
  for (const n of plan.notes) console.log(`[import] ${n}`);
  console.log(
    `[import] ${plan.type}: ${plan.applied} ${dryRun ? "would apply" : "applied"}, ${plan.rejected.length} rejected`,
  );
  if (dryRun || plan.applied === 0) {
    if (plan.applied === 0) process.exitCode = 1;
    return;
  }

  const written = [];
  for (const [k, content] of Object.entries(plan.writes)) {
    await writeFile(FILES[k], `${JSON.stringify(content, null, 2)}\n`, "utf8");
    written.push(FILES[k]);
  }
  // Keep the answer itself beside the data it changed: the commit then says
  // both what changed and what the chat actually returned.
  await mkdir("ops/chat-output", { recursive: true });
  const kept = `ops/chat-output/${now.slice(0, 10)}-${plan.type}-${now.slice(11, 19).replace(/:/g, "")}.json`;
  await writeFile(kept, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  written.push(kept);
  console.log(`[import] wrote ${written.join(", ")}`);

  if (noCommit) return;
  const msg =
    `chore(chat-import): ${plan.type} ${plan.label}` +
    (plan.rejected.length ? `（${plan.rejected.length}件は不採用）` : "") +
    `\n\n${CHAT_MODEL} の返答を scripts/import-from-chat.mjs で取り込み。\n` +
    `入力: ${kept}\n` +
    plan.notes.map((n) => `- ${n}\n`).join("");
  execFileSync("git", ["add", ...written], { stdio: "inherit" });
  execFileSync("git", ["commit", "-q", "-m", msg], { stdio: "inherit" });
  console.log("[import] committed");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[import] failed: ${e.message}`);
    process.exit(1);
  });
}
