/**
 * Birdeye Data Services client — Solana token holders + overview.
 *
 * Used by the daily update-holders job to replace the bundled sample holder
 * data with real on-chain distribution. Only holders needs Birdeye; DEX
 * liquidity comes from tokens.xyz.
 *
 * Auth: header `X-API-KEY: $BIRDEYE_API_KEY` (set in Vercel + Actions secrets,
 * never committed). Chain is pinned to Solana via `x-chain: solana`.
 *
 * Rate limit: the account cap is 60 rpm ACROSS ALL KEYS, so every request goes
 * through a module-level throttle (min interval between calls). The daily cron
 * is the only caller, so a single serial throttle is sufficient.
 *
 * Response shapes are the documented ones but every mapper reads defensively
 * (multiple field-name fallbacks) so a young/changing API doesn't hard-fail the
 * whole snapshot — a per-token miss is skipped, not fatal.
 *
 * Docs: https://docs.birdeye.so
 */

const BASE_URL = "https://public-api.birdeye.so";
const MAX_RETRIES = 3;
/** ~50 rpm — a safe margin under the 60 rpm account cap. */
const MIN_INTERVAL_MS = 1200;

export function isBirdeyeEnabled(): boolean {
  return Boolean(process.env.BIRDEYE_API_KEY);
}

function requireApiKey(): string {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key) throw new Error("BIRDEYE_API_KEY is not set — cannot call Birdeye");
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serial throttle: hold every request at least MIN_INTERVAL_MS apart.
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

type QueryValue = string | number | boolean | null | undefined;

/** Low-level GET. 429 → backoff; non-2xx or success:false → null (skip token). */
async function apiGet<T>(
  path: string,
  query: Record<string, QueryValue> = {},
): Promise<T | null> {
  const key = requireApiKey();
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let attempt = 0;
  while (true) {
    await throttle();
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-API-KEY": key,
        "x-chain": "solana",
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const backoffMs = 2 ** attempt * 1500;
        console.warn(`[birdeye] 429 ${path} — retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms`);
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }
      console.error(`[birdeye] 429 ${path} after ${MAX_RETRIES} retries — skipping`);
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[birdeye] ${res.status} ${path} ${body.slice(0, 160)}`);
      return null;
    }

    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: T }
      | null;
    if (!json || json.success === false || json.data == null) {
      console.error(`[birdeye] ${path} returned no data (success=${json?.success})`);
      return null;
    }
    return json.data;
  }
}

// ── Response shapes (read defensively) ───────────────────────────────────────

export interface BirdeyeHolderItem {
  owner?: string;
  address?: string;
  token_account?: string;
  amount?: string | number;
  ui_amount?: number;
  uiAmount?: number;
  decimals?: number;
}

export interface BirdeyeHolderResponse {
  items?: BirdeyeHolderItem[];
  total?: number;
}

export interface BirdeyeOverview {
  symbol?: string;
  decimals?: number;
  supply?: number;
  circulatingSupply?: number;
  holder?: number;
  holders?: number;
  [k: string]: unknown;
}

/** Top token holders (paginated; one page of up to `limit`). */
export function getTokenHolders(
  mint: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<BirdeyeHolderResponse | null> {
  return apiGet<BirdeyeHolderResponse>("/defi/v3/token/holder", {
    address: mint,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 100,
  });
}

/** Token overview — carries circulating supply + holder count. */
export function getTokenOverview(mint: string): Promise<BirdeyeOverview | null> {
  return apiGet<BirdeyeOverview>("/defi/token_overview", { address: mint });
}
