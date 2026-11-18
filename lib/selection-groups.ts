/** Shared with the client table: no server imports here. */
import type { Result, RowStatus } from "@/lib/company-record";

export type Group = "weekly" | "us-stocks" | "neocloud" | "physical-ai" | "jp-sectors";

export const GROUPS: Array<{ id: Group; label: string }> = [
  { id: "weekly", label: "Weekly picks" },
  { id: "us-stocks", label: "US stocks" },
  { id: "neocloud", label: "Neocloud" },
  { id: "physical-ai", label: "Physical AI" },
  { id: "jp-sectors", label: "Japan sectors" },
];

export interface SelectionRow {
  id: string;
  ticker: string;
  company: string;
  group: Group;
  /** Where the condition was set (the record's population label). */
  population: string;
  /** What has to be disclosed for a hit: the checkable rule when there is one, else the question. */
  condition: string;
  target_date: string;
  result: Result;
  status: RowStatus;
  evidence_url: string | null;
  /** The stock has its own page (/solana-stocks/{ticker}). */
  has_page?: boolean;
}

