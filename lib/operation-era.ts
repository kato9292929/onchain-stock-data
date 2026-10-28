import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Which regime produced a row: the API selection in Actions, or the chat
 * operation that replaced it on 2026-10-28.
 *
 * Kept like `US_AUTOREGISTER_FROM` (lib/evaluation-coverage.ts): a dated
 * change to how the record is made, so the weeks on either side can be
 * aggregated separately. A chat-selected week is a different model working
 * from different inputs; its hit-rate is its own, not a continuation.
 *
 * The dates are not known in advance, so they live in data/operation-eras.json
 * and are written by scripts/import-from-chat.mjs on the first import of each
 * kind, never moved afterwards.
 */

export type Era = "api" | "chat";
export type Market = "US" | "JP";

export interface OperationEras {
  note?: string;
  /** week_of of the first chat-selected week, per market; null until then. */
  selection_chat_from: Record<Market, string | null>;
  /** Date of the first chat verdict import; null until then. */
  verdicts_chat_from: string | null;
}

export const NO_CHAT_YET: OperationEras = {
  selection_chat_from: { US: null, JP: null },
  verdicts_chat_from: null,
};

export async function getOperationEras(): Promise<OperationEras> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "operation-eras.json"),
      "utf8",
    );
    return JSON.parse(raw) as OperationEras;
  } catch {
    return NO_CHAT_YET;
  }
}

/** The regime that selected the week. */
export function selectionEra(
  market: Market,
  weekOf: string,
  eras: OperationEras,
): Era {
  const from = eras.selection_chat_from?.[market];
  return from && weekOf >= from ? "chat" : "api";
}

/** Split rows (evaluations or holdings) by the regime that selected them. */
export function splitByEra<T extends { week_of: string }>(
  rows: readonly T[],
  market: Market,
  eras: OperationEras,
): Record<Era, T[]> {
  const out: Record<Era, T[]> = { api: [], chat: [] };
  for (const r of rows) out[selectionEra(market, r.week_of, eras)].push(r);
  return out;
}
