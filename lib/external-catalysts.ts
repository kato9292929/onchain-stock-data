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
  market?: unknown;
  source?: unknown;
  conviction?: unknown;
  agent_id?: unknown;
}

export interface ValidatedSubmission {
  ticker: string;
  catalyst_description: string;
  target_date: string; // YYYY-MM-DD
  submitter_contact: string | null;
  market: "US" | "JP";
  source: string | null;
  conviction: number | null;
  agent_id: string | null;
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

  // market (optional) — defaults to "US"; only "US" | "JP" allowed.
  let market: "US" | "JP" = "US";
  if (body.market != null) {
    if (body.market !== "US" && body.market !== "JP") {
      return {
        ok: false,
        field: "market",
        message: 'market must be "US" or "JP"',
      };
    }
    market = body.market;
  }

  // source (optional) — free-form provenance label, max 200 chars.
  let source: string | null = null;
  if (body.source != null) {
    if (typeof body.source !== "string") {
      return { ok: false, field: "source", message: "source must be a string" };
    }
    const s = body.source.trim();
    if (s.length > 200) {
      return {
        ok: false,
        field: "source",
        message: "source must be 200 characters or fewer",
      };
    }
    source = s === "" ? null : s;
  }

  // conviction (optional) — confidence in [0, 1].
  let conviction: number | null = null;
  if (body.conviction != null) {
    if (
      typeof body.conviction !== "number" ||
      Number.isNaN(body.conviction) ||
      body.conviction < 0 ||
      body.conviction > 1
    ) {
      return {
        ok: false,
        field: "conviction",
        message: "conviction must be a number between 0 and 1",
      };
    }
    conviction = body.conviction;
  }

  // agent_id (optional) — signing agent identifier, max 200 chars.
  let agent_id: string | null = null;
  if (body.agent_id != null) {
    if (typeof body.agent_id !== "string") {
      return {
        ok: false,
        field: "agent_id",
        message: "agent_id must be a string",
      };
    }
    const a = body.agent_id.trim();
    if (a.length > 200) {
      return {
        ok: false,
        field: "agent_id",
        message: "agent_id must be 200 characters or fewer",
      };
    }
    agent_id = a === "" ? null : a;
  }

  return {
    ok: true,
    value: {
      ticker,
      catalyst_description: desc,
      target_date,
      submitter_contact,
      market,
      source,
      conviction,
      agent_id,
    },
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
    market: v.market ?? "US",
    source: v.source ?? null,
    conviction: v.conviction ?? null,
    agent_id: v.agent_id ?? null,
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
    if (!Array.isArray(parsed)) return [];
    // Legacy/US entries may omit `market`; normalise the default so callers
    // (judge, list endpoint) can branch on it without per-site null checks.
    return (parsed as ExternalCatalyst[]).map((c) => ({
      ...c,
      market: c.market ?? "US",
    }));
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
