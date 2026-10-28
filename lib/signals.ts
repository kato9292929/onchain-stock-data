import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * External signals layer.
 *
 * The portfolio thesis format is single-sided: date + numeric threshold +
 * upside. It has no home for bearish or structural (regime) signals, and no way
 * to hold a signal that has no judgement date. Forcing such signals into the
 * scored catalyst format pollutes the hit-rate denominator with items that can
 * never be adjudicated.
 *
 * A Signal separates two orthogonal axes so both problems go away:
 *   - `direction`     bullish / bearish / structural — the missing side.
 *   - `judgeability`  judgeable / conditionable / context — can we score it yet?
 * plus `verified` (primary-source confirmed) and `source_tier`.
 *
 * Scoring rule (keeps the hit-rate clean): a signal enters any hit-rate ONLY
 * when it is `judgeable` AND `verified`. Everything else feeds the selection
 * prompt as context but is never adjudicated.
 */

export type SignalDirection = "bullish" | "bearish" | "structural";

/** judgeable: has (date|observable) + threshold, resolvable now.
 *  conditionable: partially specified — becomes judgeable once a date/threshold
 *  is added. context: structural / no threshold — informs, never scored. */
export type SignalJudgeability = "judgeable" | "conditionable" | "context";

export type SignalSourceTier = "primary" | "secondary" | "opinion" | "leak";

export interface Signal {
  id: string;
  /** One-line claim. */
  claim: string;
  /** 根拠 — the mechanism / evidence behind the claim. */
  basis?: string;
  direction: SignalDirection;
  /** Ticker or theme the signal bears on, e.g. "NVDA", "AI-infra", "JP-rates". */
  scope: string;
  /** Specific affected tickers, when the signal names them. */
  tickers?: string[];
  /** Observable series/metric to watch (e.g. "10y+ IG credit spread"). */
  observable?: string;
  /** Condition that decides the call (e.g. "spread > 200bps"). */
  threshold?: string;
  /** Judgement date (YYYY-MM-DD) when the signal is date-anchored. */
  target_date?: string;
  source: string;
  source_tier: SignalSourceTier;
  /** Primary source confirmed? Unverified signals are never scored. */
  verified: boolean;
  /** Optional explicit override; derived from the fields when absent. */
  judgeability?: SignalJudgeability;
  /** Adjudication (only meaningful for scored signals). */
  status?: "pending" | "hit" | "partial" | "miss" | "na";
  judgement_date?: string | null;
  reasoning?: string | null;
  added_at?: string;
}

export interface SignalsFile {
  source: string;
  note: string;
  updated_at: string;
  signals: Signal[];
}

const DATA_DIR = path.join(process.cwd(), "data");

/** Read data/signals.json. Missing/invalid file → empty set (never throws). */
export async function getSignals(): Promise<SignalsFile> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "signals.json"), "utf8");
    const parsed = JSON.parse(raw) as SignalsFile;
    if (!parsed || !Array.isArray(parsed.signals)) throw new Error("shape");
    return parsed;
  } catch {
    return { source: "signals", note: "", updated_at: "", signals: [] };
  }
}

/**
 * Derive judgeability from the fields (unless explicitly set):
 * - judgeable    — resolvable anchor (date OR observable) AND a threshold.
 * - conditionable — has one of {date, observable, threshold} but not a full pair.
 * - context      — structural: no threshold and no resolvable anchor.
 */
export function judgeabilityOf(s: Signal): SignalJudgeability {
  if (s.judgeability) return s.judgeability;
  const resolvable = Boolean(s.target_date || s.observable);
  const threshold = Boolean(s.threshold);
  if (resolvable && threshold) return "judgeable";
  if (resolvable || threshold) return "conditionable";
  return "context";
}

/** A signal counts toward hit-rate ONLY when judgeable AND verified. */
export function isScorable(s: Signal): boolean {
  return judgeabilityOf(s) === "judgeable" && s.verified === true;
}

/** The subset that may enter a hit-rate denominator. */
export function scorableSignals(signals: Signal[]): Signal[] {
  return signals.filter(isScorable);
}

const DIRECTION_LABEL: Record<SignalDirection, string> = {
  bullish: "強気 (追い風)",
  bearish: "弱気 (回避・アンダーウェイト材料)",
  structural: "構造/レジーム (前提として考慮)",
};

/**
 * Render signals as a selection-prompt context section, grouped by direction.
 * Long-only guidance is explicit: bearish → avoid/underweight; structural →
 * regime tilt. Unverified / non-judgeable signals are labelled so the model
 * discounts them, and none of this is scored.
 */
/**
 * The day unverified signals stopped reaching the selection prompt.
 *
 * Treated like `US_AUTOREGISTER_FROM`: a dated change to what the model is
 * given, so a week's selection can be read against the inputs it actually had.
 * Weeks before this date saw unverified signals; weeks after do not.
 */
export const VERIFIED_ONLY_FROM = "2026-10-17";

/**
 * Drop signals that have not been verified.
 *
 * The prompt used to carry them with a 「未検証」 tag and an instruction to
 * discount them. That is not what came out: `sig_nvda_circular_financing`
 * (verified false, sourced to an X post relaying WSJ, amounts unconfirmed)
 * reappeared in eight weeks of published `rationale` as a flat assertion —
 * 「循環取引疑惑を踏まえ」 — with no hedge and no source. A label the model is
 * free to ignore is not a control, so the row does not go in at all.
 *
 * `data/signals.json` is left alone: scoring and other callers read the same
 * file, and this is a decision about one prompt, not about the record.
 */
export function selectableSignals(file: SignalsFile | null): {
  kept: Signal[];
  droppedIds: string[];
} {
  const signals = file?.signals ?? [];
  const kept = signals.filter((s) => s.verified);
  return {
    kept,
    droppedIds: signals.filter((s) => !s.verified).map((s) => s.id),
  };
}

export function formatSignalsForPrompt(file: SignalsFile | null): string {
  const { kept: signals } = selectableSignals(file);
  if (signals.length === 0) return "";

  const lines: string[] = [
    "",
    "## 外部シグナル (選定の文脈・採点対象ではない)",
    "強気=候補/オーバーウェイトの支え、弱気=回避/アンダーウェイト材料、構造=レジーム前提。",
    "未検証のシグナルは渡していない。「参考」タグは判定不能という意味で、確度が低いので割り引いて扱うこと。",
  ];

  for (const dir of ["bullish", "bearish", "structural"] as SignalDirection[]) {
    const group = signals.filter((s) => s.direction === dir);
    if (group.length === 0) continue;
    lines.push("", `### ${DIRECTION_LABEL[dir]}`);
    for (const s of group) {
      const j = judgeabilityOf(s);
      // `verified` is guaranteed true here by selectableSignals.
      const tags: string[] = [];
      if (j !== "judgeable") tags.push("参考");
      const tag = tags.length ? ` [${tags.join("・")}]` : "";
      const when = s.target_date ? ` (期日 ${s.target_date})` : "";
      lines.push(`- [${s.scope}] ${s.claim}${when}${tag}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
