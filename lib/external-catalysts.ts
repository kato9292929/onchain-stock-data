import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ExternalCatalyst } from "@/lib/data";

/**
 * Phase A — external catalyst submission helpers.
 *
 * Pure validation / dedup / id logic kept out of the route so it can be unit
 * tested without a running Next server. Persistence is best-effort: on Vercel
 * the FS is read-only, so writes may fail — the daily evaluate-catalysts job
 * (GitHub Actions) is the durable, git-committed store. The route still
 * returns the created record so a submission is never silently lost.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "external-catalysts.json");

export const GRACE_DAYS = 7;

export interface SubmitInput {
  ticker?: unknown;
  catalyst_description?: unknown;
  target_date?: unknown;
  submitter_contact?: unknown;
}

export interface ValidatedSubmission {
  ticker: string;
  catalyst_description: string;
  target_date: string; // YYYY-MM-DD
  submitter_contact: string | null;
}

export type ValidationResult =
  | { ok: true; value: ValidatedSubmission }
  | { ok: false; field: string; message: string };

const TICKER_RE = /^[A-Za-z0-9]{1,10}$/;
// Accept full ISO 8601 or plain YYYY-MM-DD; normalise to the date part.
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

/** Validate + normalise a raw submission body. */
export function validateSubmission(body: SubmitInput): ValidationResult {
  // ticker
  if (typeof body.ticker !== "string" || body.ticker.trim() === "") {
    return { ok: false, field: "ticker", message: "ticker is required" };
  }
  const ticker = body.ticker.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return {
      ok: false,
      field: "ticker",
      message: "ticker must be 1-10 alphanumeric characters",
    };
  }

  // catalyst_description
  if (
    typeof body.catalyst_description !== "string" ||
    body.catalyst_description.trim() === ""
  ) {
    return {
      ok: false,
      field: "catalyst_description",
      message: "catalyst_description is required",
    };
  }
  const desc = body.catalyst_description.trim();
  if (desc.length < 10 || desc.length > 500) {
    return {
      ok: false,
      field: "catalyst_description",
      message: "catalyst_description must be 10-500 characters",
    };
  }

  // target_date
  if (typeof body.target_date !== "string" || body.target_date.trim() === "") {
    return {
      ok: false,
      field: "target_date",
      message: "target_date is required",
    };
  }
  const rawDate = body.target_date.trim();
  if (!ISO_RE.test(rawDate)) {
    return {
      ok: false,
      field: "target_date",
      message: "target_date must be ISO 8601 (YYYY-MM-DD)",
    };
  }
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      field: "target_date",
      message: "target_date is not a valid date",
    };
  }
  const target_date = rawDate.slice(0, 10);
  // Must be in the future (strictly after today, UTC date comparison).
  if (target_date <= todayIso()) {
    return {
      ok: false,
      field: "target_date",
      message: "target_date must be a future date",
    };
  }

  // submitter_contact (optional)
  let submitter_contact: string | null = null;
  if (body.submitter_contact != null) {
    if (typeof body.submitter_contact !== "string") {
      return {
        ok: false,
        field: "submitter_contact",
        message: "submitter_contact must be a string",
      };
    }
    const c = body.submitter_contact.trim();
    if (c.length > 500) {
      return {
        ok: false,
        field: "submitter_contact",
        message: "submitter_contact must be 500 characters or fewer",
      };
    }
    submitter_contact = c === "" ? null : c;
  }

  return {
    ok: true,
    value: { ticker, catalyst_description: desc, target_date, submitter_contact },
  };
}

export function generateCatalystId(): string {
  // ext_ + 8 hex chars.
  return `ext_${randomBytes(4).toString("hex")}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO date `n` days after `iso` (YYYY-MM-DD). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** When a freshly-submitted catalyst becomes eligible for evaluation. */
export function estimatedEvalDate(target_date: string): string {
  return addDays(target_date, GRACE_DAYS);
}

/** Two submissions collide when ticker + description + target_date all match. */
export function findDuplicate(
  list: ExternalCatalyst[],
  v: ValidatedSubmission,
): ExternalCatalyst | undefined {
  return list.find(
    (c) =>
      c.ticker === v.ticker &&
      c.catalyst_description === v.catalyst_description &&
      c.target_date === v.target_date,
  );
}

export function buildCatalyst(v: ValidatedSubmission): ExternalCatalyst {
  return {
    catalyst_id: generateCatalystId(),
    ticker: v.ticker,
    catalyst_description: v.catalyst_description,
    target_date: v.target_date,
    submitted_at: new Date().toISOString(),
    submitter_contact: v.submitter_contact,
    status: "pending",
    judgement_date: null,
    evidence_urls: [],
    reasoning: null,
  };
}

export async function readExternalCatalysts(): Promise<ExternalCatalyst[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExternalCatalyst[]) : [];
  } catch {
    return [];
  }
}

export async function writeExternalCatalysts(
  list: ExternalCatalyst[],
): Promise<{ persisted: boolean; reason?: string }> {
  try {
    await fs.writeFile(FILE, `${JSON.stringify(list, null, 2)}\n`, "utf8");
    return { persisted: true };
  } catch (e) {
    return { persisted: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function scoreLookupUrl(catalyst_id: string): string {
  return `/api/alpha/catalyst/${catalyst_id}/score`;
}
