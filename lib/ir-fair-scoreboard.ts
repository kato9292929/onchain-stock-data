import { promises as fs } from "node:fs";
import path from "node:path";
import type { EvaluationStatus } from "./data";

/**
 * IR Fair 2026 themed scoreboard.
 *
 * A second, sector-grouped catalyst board alongside the Physical-AI series. The
 * ~190 IR-Fair exhibitors are grouped into 10 themes (T1–T10). Each entry is
 * scored on the SAME framework as Physical-AI (a dated, binary success/fail
 * condition judged once at its deadline) — but ONLY once it has been verified
 * from primary sources and promoted from `stage: "draft"` to `stage: "active"`.
 *
 * Cost discipline (mirrors AGENTS.md): this file is a static roster. No LLM
 * touches it on ingest; `draft` rows are display-only and are never scored.
 * Wiring active rows into the evaluate cron is a later, separate step.
 */

export type IrFairType = "earnings" | "mission" | "ir_event" | "policy";
export type IrFairStage = "draft" | "active";

export interface IrFairTheme {
  id: string;
  title_en: string;
  title_ja: string;
  type: IrFairType;
  priority: number;
}

export interface IrFairCatalyst {
  catalyst_id: string;
  ticker: string;
  company_name: string;
  market: "JP" | "US";
  theme: string;
  type: IrFairType;
  stage: IrFairStage;
  due_date: string | null;
  success_condition: string | null;
  fail_condition: string | null;
  source: string | null;
  status: EvaluationStatus;
}

export interface IrFairFile {
  source: string;
  note: string;
  updated_at: string;
  themes: IrFairTheme[];
  catalysts: IrFairCatalyst[];
}

export const TYPE_LABEL: Record<IrFairType, string> = {
  earnings: "Earnings",
  mission: "Mission",
  ir_event: "IR event",
  policy: "Policy",
};

const DATA_PATH = path.join(process.cwd(), "data", "ir-fair-2026-catalysts.json");

/** Read the IR-Fair roster. Missing/invalid → empty (never throws). */
export async function getIrFairFile(): Promise<IrFairFile> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as IrFairFile;
    if (!parsed || !Array.isArray(parsed.themes) || !Array.isArray(parsed.catalysts)) {
      throw new Error("shape");
    }
    return parsed;
  } catch {
    return { source: "", note: "", updated_at: "", themes: [], catalysts: [] };
  }
}

export interface IrFairThemeBoard extends IrFairTheme {
  companies: IrFairCatalyst[];
  total: number;
  active: number;
  draft: number;
  counts: Record<"hit" | "partial" | "miss" | "na" | "pending", number>;
  /** (hit + partial×0.5) / (hit + partial + miss) over ACTIVE rows; null if none scored. */
  hit_rate: number | null;
}

export interface IrFairBoard {
  as_of: string;
  themes: IrFairThemeBoard[];
  overall: { total: number; active: number; draft: number };
}

/**
 * Group the roster by theme (in theme-priority order) and compute per-theme
 * counts + a hit-rate over ACTIVE rows only. Draft rows are counted separately
 * so the UI can show "roster ready, conditions pending" without polluting any
 * hit-rate.
 */
export function buildIrFairBoard(file: IrFairFile, asOf: string): IrFairBoard {
  const byTheme = new Map<string, IrFairCatalyst[]>();
  for (const c of file.catalysts) {
    if (!byTheme.has(c.theme)) byTheme.set(c.theme, []);
    byTheme.get(c.theme)!.push(c);
  }

  const themes = [...file.themes]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((t): IrFairThemeBoard => {
      const companies = (byTheme.get(t.id) ?? []).sort((a, b) =>
        a.ticker.localeCompare(b.ticker),
      );
      const active = companies.filter((c) => c.stage === "active");
      const counts = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0 };
      for (const c of active) counts[c.status] += 1;
      const scored = counts.hit + counts.partial + counts.miss;
      const hit_rate =
        scored > 0 ? (counts.hit + counts.partial * 0.5) / scored : null;
      return {
        ...t,
        companies,
        total: companies.length,
        active: active.length,
        draft: companies.length - active.length,
        counts,
        hit_rate,
      };
    });

  const total = file.catalysts.length;
  const active = file.catalysts.filter((c) => c.stage === "active").length;
  return {
    as_of: asOf,
    themes,
    overall: { total, active, draft: total - active },
  };
}
