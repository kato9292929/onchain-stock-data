/**
 * Shared vocabulary of the chat operation (since 2026-10-28).
 *
 * Selection and judging moved off the Anthropic API: CC writes the work out
 * (scripts/export-for-chat.mjs), the model in chat does it, and CC reads the
 * answer back in (scripts/import-from-chat.mjs). Both sides must agree on what
 * a row is called and when it becomes judgeable, so that lives here and only
 * here. Plain .mjs with no dependencies.
 */

/** Who judged or selected, as written into every imported row. */
export const CHAT_MODEL = "claude-fable-5-1 (chat)";

/** Same seven days the API evaluator waited after a deadline. */
export const GRACE_DAYS = 7;

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The later of the condition's own deadline and the date the company actually
 * published (where a reconciliation found one), plus the grace. Mirrors
 * `judgeableFrom` in scripts/evaluate-catalysts.mjs.
 */
export function judgeableFrom(targetDate, confirmed) {
  const basis = confirmed && confirmed > targetDate ? confirmed : targetDate;
  return addDays(basis, GRACE_DAYS);
}

/** Split 「成立条件【外れ方向】…」. Same rule as scripts/evaluate-catalysts.mjs. */
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
 * Row ids. Stable, readable, and parseable back to the file and row they name:
 *   us:<week_of>:<ticker>   data/portfolio-evaluations.json
 *   jp:<week_of>:<ticker>   data/jp-portfolio-evaluations.json
 *   ext:<catalyst_id>       data/external-catalysts.json (Physical AI series)
 *   irf:<catalyst_id>       data/ir-fair-2026-catalysts.json (active only)
 */
export const POPULATIONS = {
  us: "US Weekly Selection",
  jp: "JP Weekly Selection",
  ext: "Physical AI（外部 catalyst）",
  irf: "IR Fair 2026（active）",
};

export function rowId(kind, a, b) {
  return b === undefined ? `${kind}:${a}` : `${kind}:${a}:${String(b).toUpperCase()}`;
}

export function parseRowId(id) {
  const m = String(id ?? "").match(/^(us|jp):(\d{4}-\d{2}-\d{2}):([A-Z0-9.\-]+)$/);
  if (m) return { kind: m[1], week_of: m[2], ticker: m[3] };
  const n = String(id ?? "").match(/^(ext|irf):(.+)$/);
  if (n) return { kind: n[1], catalyst_id: n[2] };
  return null;
}

/** Every portfolio week, newest first, wherever it lives in the file. */
export function weeksOf(historyFile) {
  return [
    ...(historyFile?.current ? [historyFile.current] : []),
    ...(Array.isArray(historyFile?.history) ? historyFile.history : []),
  ].filter((p) => p?.week_of && Array.isArray(p.holdings));
}

/** (week_of, ticker) → holding, for name / provenance lookups. */
export function holdingIndex(historyFile) {
  const out = new Map();
  for (const p of weeksOf(historyFile)) {
    for (const h of p.holdings) {
      const k = `${p.week_of}::${String(h.ticker ?? "").toUpperCase()}`;
      if (!out.has(k)) out.set(k, h);
    }
  }
  return out;
}

/**
 * Every scored condition across the four populations, normalised to one shape.
 * `files` is { usEvals, usHistory, jpEvals, jpHistory, externals, irFair }.
 * Returned rows keep a reference to the source object (`ref`) so the importer
 * can write back into the very row the id named.
 */
export function collectRows(files) {
  const rows = [];
  for (const [kind, evals, history] of [
    ["us", files.usEvals, files.usHistory],
    ["jp", files.jpEvals, files.jpHistory],
  ]) {
    const idx = holdingIndex(history);
    for (const e of evals?.evaluations ?? []) {
      const ticker = String(e.ticker ?? "").toUpperCase();
      const h = idx.get(`${e.week_of}::${ticker}`) ?? {};
      const { success, failDirection } = splitCondition(e.success_condition);
      rows.push({
        id: rowId(kind, e.week_of, ticker),
        kind,
        population: POPULATIONS[kind],
        ticker,
        company_name: h.company_name ?? null,
        week_of: e.week_of,
        success_condition: success,
        fail_direction: failDirection,
        target_date: e.catalyst_target_date ?? null,
        // Absent means unrecorded (lib/data.ts), not "model" — though every
        // deadline written before 2026-10-17 did come from the selection model.
        target_date_source: h.target_date_source ?? "未記録",
        target_date_confirmed: h.target_date_confirmed ?? null,
        target_date_confirmed_source: h.target_date_confirmed_source ?? null,
        target_date_checked_at: h.target_date_checked_at ?? null,
        thesis: h.thesis ?? null,
        condition_source: e.condition_source ?? null,
        status: e.status,
        ref: e,
      });
    }
  }
  for (const c of files.externals ?? []) {
    const { success, failDirection } = splitCondition(c.catalyst_description);
    rows.push({
      id: rowId("ext", c.catalyst_id),
      kind: "ext",
      population: POPULATIONS.ext,
      ticker: String(c.ticker ?? "").toUpperCase(),
      company_name: c.company_name ?? null,
      week_of: null,
      success_condition: success,
      fail_direction: failDirection,
      target_date: c.target_date ?? null,
      target_date_source: c.date_confidence ? `article（${c.date_confidence}）` : "article",
      target_date_confirmed: null,
      catalyst_type: c.catalyst_type ?? null,
      source: c.source ?? null,
      status: c.status,
      ref: c,
    });
  }
  for (const c of files.irFair?.catalysts ?? []) {
    // Only `active` rows are scored; review/draft are not conditions yet.
    if (c.stage !== "active") continue;
    rows.push({
      id: rowId("irf", c.catalyst_id),
      kind: "irf",
      population: POPULATIONS.irf,
      ticker: String(c.ticker ?? "").toUpperCase(),
      company_name: c.company_name ?? null,
      week_of: null,
      success_condition: String(c.success_condition ?? "").trim(),
      fail_direction: c.fail_condition ? String(c.fail_condition).trim() : null,
      target_date: c.due_date ?? null,
      target_date_source: c.date_estimated ? "research（推定）" : "research（会社開示）",
      target_date_confirmed: null,
      source: c.source ?? null,
      status: c.status ?? "pending",
      ref: c,
    });
  }
  return rows;
}

// ── condition wording (import:chat selection, audit) ──────────────────────

/**
 * Words that say a result was good without saying how good. A condition that
 * leans on one of these and carries no number cannot be judged the same way
 * twice, so the importer refuses it.
 */
export const VAGUE_WORDS = [
  "好材料",
  "上振れ",
  "下振れ",
  "堅調",
  "改善",
  "好調",
  "順調",
  "底堅",
  "底打ち",
  "回復基調",
  "増益基調",
  "拡大基調",
  "力強い",
  "良好",
];

export const OPERATORS = new Set([">", ">=", "<", "<="]);

/**
 * True when the text states a numeric threshold: a number with a unit (%, 億円,
 * ドル, 倍, bp …) or a currency-prefixed amount. Dates, quarters and fiscal
 * years do not count.
 */
export function hasNumericThreshold(text) {
  const t = String(text ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\d{4}[年/-]\d{1,2}([月/-]\d{1,2}日?)?/g, " ")
    .replace(/\d{1,2}[/月]\d{1,2}日?/g, " ")
    .replace(/(FY|CY)\s?\d{2,4}|\d{4}年\d{1,2}月期|\d+月期|第\s?\d\s?四半期|Q\d|\dQ|\d{2,4}年/g, " ");
  return (
    /\d[\d,.]*\s*(%|％|ポイント|pt|bp|億|兆|万|百万|円|ドル|倍|件|台|社|人|kW|MW|GW|million|billion|[BMK]\b)/i.test(t) ||
    /[$¥€]\s?\d/.test(t) ||
    /[一二三]桁/.test(t)
  );
}

/** The vague words a text uses, when it has no numeric threshold to back them. */
export function vagueWithoutNumber(text) {
  const s = String(text ?? "");
  const hits = VAGUE_WORDS.filter((w) => s.includes(w));
  return hits.length > 0 && !hasNumericThreshold(s) ? hits : [];
}

/**
 * Validate one holding's structured success conditions. Each needs
 *   metric     what is measured (no vague word)
 *   operator   > >= < <=
 *   threshold  { value: number, unit: string }
 *   source_doc the document it will be judged against (決算短信, 10-Q, …)
 * Returns error strings, prefixed with `at`.
 */
export function validateSuccessConditions(list, at) {
  const errors = [];
  if (!Array.isArray(list) || list.length === 0) {
    return [`${at}: success_conditions (metric / operator / threshold / source_doc) is required`];
  }
  for (const [j, c] of list.entries()) {
    const p = `${at}.success_conditions[${j}]`;
    const metric = typeof c?.metric === "string" ? c.metric.trim() : "";
    if (!metric) errors.push(`${p}: metric is required`);
    const vague = VAGUE_WORDS.filter((w) => metric.includes(w));
    if (vague.length) errors.push(`${p}: metric uses vague wording (${vague.join("・")}); name the quantity`);
    if (!OPERATORS.has(c?.operator)) errors.push(`${p}: operator must be one of > >= < <=`);
    const v = c?.threshold?.value;
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${p}: threshold.value must be a number`);
    if (!(typeof c?.threshold?.unit === "string" && c.threshold.unit.trim())) {
      errors.push(`${p}: threshold.unit is required (%, 億円, USD, 倍 …)`);
    }
    if (!(typeof c?.source_doc === "string" && c.source_doc.trim())) {
      errors.push(`${p}: source_doc is required (the document it is judged against)`);
    }
  }
  return errors;
}
