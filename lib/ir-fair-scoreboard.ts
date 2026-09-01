import { promises as fs } from "node:fs";
import path from "node:path";
import type { EvaluationStatus } from "./data";

/**
 * IR Fair 2026 sector scoreboard.
 *
 * A second catalyst board alongside the Physical-AI series, grouping the ~190
 * Nikkei × TSE IR Fair 2026 exhibitors by their TSE 33-sector. Each entry is
 * meant to be scored on the SAME framework as Physical-AI (a dated, binary
 * success/fail condition judged once at its deadline) — but ONLY once it has
 * been verified from primary sources and promoted from `stage: "draft"` to
 * `stage: "active"`.
 *
 * Cost discipline (mirrors AGENTS.md): this file is a static roster. No LLM
 * touches it on ingest; `draft` rows are display-only and are never scored.
 * Wiring active rows into the evaluate cron is a later, separate step.
 */

export type IrFairStage = "draft" | "active";

export interface IrFairSector {
  id: string;
  title_en: string;
  title_ja: string;
  priority: number;
}

export interface IrFairCatalyst {
  catalyst_id: string;
  ticker: string;
  company_name: string;
  market: "JP" | "US";
  tse_market?: string;
  sector: string;
  stage: IrFairStage;
  /** One-line business line in the AI/sector thesis (from research). */
  business_line?: string | null;
  /** Latest disclosed figures (百万円 / JPY millions), from public IR. */
  revenue?: number | null;
  operating_income?: number | null;
  fiscal_period?: string | null;
  disclosed_at?: string | null;
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
  sectors: IrFairSector[];
  catalysts: IrFairCatalyst[];
}

const DATA_PATH = path.join(process.cwd(), "data", "ir-fair-2026-catalysts.json");

/** Read the IR-Fair roster. Missing/invalid → empty (never throws). */
export async function getIrFairFile(): Promise<IrFairFile> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as IrFairFile;
    if (!parsed || !Array.isArray(parsed.sectors) || !Array.isArray(parsed.catalysts)) {
      throw new Error("shape");
    }
    return parsed;
  } catch {
    return { source: "", note: "", updated_at: "", sectors: [], catalysts: [] };
  }
}

export interface IrFairSectorBoard extends IrFairSector {
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
  sectors: IrFairSectorBoard[];
  overall: { total: number; active: number; draft: number; sectors: number };
}

/**
 * Group the roster by TSE sector (in priority order = descending company
 * count) and compute per-sector counts + a hit-rate over ACTIVE rows only.
 * Draft rows are counted separately so the UI can show "roster ready,
 * conditions pending" without polluting any hit-rate.
 */
export function buildIrFairBoard(file: IrFairFile, asOf: string): IrFairBoard {
  const bySector = new Map<string, IrFairCatalyst[]>();
  for (const c of file.catalysts) {
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector)!.push(c);
  }

  const sectors = [...file.sectors]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((s): IrFairSectorBoard => {
      const companies = (bySector.get(s.id) ?? []).sort((a, b) =>
        a.ticker.localeCompare(b.ticker),
      );
      const active = companies.filter((c) => c.stage === "active");
      const counts = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0 };
      for (const c of active) counts[c.status] += 1;
      const scored = counts.hit + counts.partial + counts.miss;
      const hit_rate =
        scored > 0 ? (counts.hit + counts.partial * 0.5) / scored : null;
      return {
        ...s,
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
    sectors,
    overall: { total, active, draft: total - active, sectors: sectors.length },
  };
}
