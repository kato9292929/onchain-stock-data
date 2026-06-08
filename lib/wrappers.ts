/**
 * Phase 1 — upstream fetch + transform for the x402 wrapper endpoints.
 *
 * Kept out of the route files so the fetch/transform/error logic is unit
 * testable (the route layer only adds the x402 paywall + CORS). API keys are
 * read from env here and never returned to the caller.
 *
 * AA (the alt-data agent) calls these daily through x402 and feeds the result
 * into its own pipeline; osd's own cron also consumes AA's aggregated output
 * (see lib/external-data.ts).
 */

const BIRDEYE_BASE = "https://public-api.birdeye.so";
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const PERPLEXITY_MODEL = "sonar";
const UPSTREAM_TIMEOUT_MS = 15_000;

export type WrapperError = {
  kind: "missing_api_key" | "bad_request" | "upstream_error" | "timeout";
  status: number; // HTTP status to surface to the wrapper caller
  message: string;
};

export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BirdeyeResult {
  address: string;
  candles: Candle[];
  fetched_at: string;
}

/** Allowed Birdeye OHLCV interval types. */
const BIRDEYE_TYPES = new Set([
  "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "8H", "12H",
  "1D", "3D", "1W", "1M",
]);

type FetchFn = typeof fetch;

/** Fetch + trim Birdeye OHLCV down to the candle array AI judgement needs. */
export async function fetchBirdeyeOhlcv(
  input: { address?: unknown; type?: unknown; limit?: unknown },
  deps: { fetchImpl?: FetchFn; apiKey?: string } = {},
): Promise<{ ok: true; value: BirdeyeResult } | { ok: false; err: WrapperError }> {
  const apiKey = deps.apiKey ?? process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    return { ok: false, err: { kind: "missing_api_key", status: 503, message: "BIRDEYE_API_KEY is not set" } };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (typeof input.address !== "string" || input.address.trim() === "") {
    return { ok: false, err: { kind: "bad_request", status: 400, message: "address is required" } };
  }
  const address = input.address.trim();
  const type = typeof input.type === "string" && BIRDEYE_TYPES.has(input.type) ? input.type : "1D";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(Math.trunc(input.limit), 1), 1000)
      : 30;

  // Birdeye OHLCV is a time-range query; derive `time_from` from limit × type.
  const nowSec = Math.floor(Date.now() / 1000);
  const timeFrom = nowSec - limit * intervalSeconds(type);
  const url =
    `${BIRDEYE_BASE}/defi/ohlcv?address=${encodeURIComponent(address)}` +
    `&type=${encodeURIComponent(type)}&time_from=${timeFrom}&time_to=${nowSec}`;

  let res: Response;
  try {
    res = await withTimeout(
      (signal) =>
        fetchImpl(url, {
          headers: { "X-API-KEY": apiKey, "x-chain": "solana", accept: "application/json" },
          signal,
        }),
    );
  } catch (e) {
    return timeoutOrError(e);
  }

  if (!res.ok) {
    return { ok: false, err: { kind: "upstream_error", status: res.status, message: `Birdeye upstream ${res.status}` } };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, err: { kind: "upstream_error", status: 502, message: "Birdeye returned non-JSON" } };
  }

  const items = extractBirdeyeItems(body);
  const candles: Candle[] = items.map((it) => ({
    ts: num(it.unixTime ?? it.t ?? it.ts),
    o: num(it.o),
    h: num(it.h),
    l: num(it.l),
    c: num(it.c),
    v: num(it.v),
  }));

  return {
    ok: true,
    value: { address, candles, fetched_at: new Date().toISOString() },
  };
}

export interface ResearchEvent {
  title: string;
  date: string;
  source_url: string;
  catalyst_suggestion: string;
}

export interface PerplexityResult {
  ticker: string;
  lookback_hours: number;
  events: ResearchEvent[];
  citations: unknown[];
  fetched_at: string;
}

export function buildPerplexityPrompt(ticker: string, lookbackHours: number): string {
  return (
    `What are the top 3 news events for ${ticker} in the past ${lookbackHours} hours? ` +
    `For each, return: event title, ISO date, source URL, and a possible catalyst ` +
    `formulation as 'target_date + condition'. Return as JSON.`
  );
}

export async function fetchPerplexityResearch(
  input: { ticker?: unknown; lookback_hours?: unknown },
  deps: { fetchImpl?: FetchFn; apiKey?: string } = {},
): Promise<{ ok: true; value: PerplexityResult } | { ok: false; err: WrapperError }> {
  const apiKey = deps.apiKey ?? process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { ok: false, err: { kind: "missing_api_key", status: 503, message: "PERPLEXITY_API_KEY is not set" } };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (typeof input.ticker !== "string" || input.ticker.trim() === "") {
    return { ok: false, err: { kind: "bad_request", status: 400, message: "ticker is required" } };
  }
  const ticker = input.ticker.trim().toUpperCase();
  const lookback_hours =
    typeof input.lookback_hours === "number" && Number.isFinite(input.lookback_hours)
      ? Math.min(Math.max(Math.trunc(input.lookback_hours), 1), 168)
      : 24;

  const prompt = buildPerplexityPrompt(ticker, lookback_hours);

  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetchImpl(PERPLEXITY_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: PERPLEXITY_MODEL,
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      }),
    );
  } catch (e) {
    return timeoutOrError(e);
  }

  if (!res.ok) {
    return { ok: false, err: { kind: "upstream_error", status: res.status, message: `Perplexity upstream ${res.status}` } };
  }

  let body: PerplexityApiResponse;
  try {
    body = (await res.json()) as PerplexityApiResponse;
  } catch {
    return { ok: false, err: { kind: "upstream_error", status: 502, message: "Perplexity returned non-JSON" } };
  }

  const content = body?.choices?.[0]?.message?.content ?? "";
  const citations = Array.isArray(body?.citations) ? body.citations : [];
  const events = parseResearchEvents(content);

  return {
    ok: true,
    value: { ticker, lookback_hours, events, citations, fetched_at: new Date().toISOString() },
  };
}

// ── helpers ────────────────────────────────────────────────────────────

interface PerplexityApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: unknown[];
}

/** Parse the model's JSON (possibly fenced) into normalized events. */
export function parseResearchEvents(content: string): ResearchEvent[] {
  let parsed: unknown;
  try {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1] : (content.match(/[[{][\s\S]*[\]}]/) || [content])[0];
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  // Accept either a bare array or { events: [...] } / { news: [...] }.
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.events ??
      (parsed as Record<string, unknown>)?.news ??
      [];
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 3).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      title: str(o.title ?? o.event_title ?? o.event ?? ""),
      date: str(o.date ?? o.iso_date ?? o.isoDate ?? ""),
      source_url: str(o.source_url ?? o.sourceUrl ?? o.url ?? o.source ?? ""),
      catalyst_suggestion: str(
        o.catalyst_suggestion ?? o.catalyst ?? o.catalyst_formulation ?? "",
      ),
    };
  });
}

function extractBirdeyeItems(body: unknown): Array<Record<string, number | undefined>> {
  const data = (body as { data?: unknown })?.data;
  const items = (data as { items?: unknown })?.items ?? data;
  return Array.isArray(items) ? (items as Array<Record<string, number | undefined>>) : [];
}

function intervalSeconds(type: string): number {
  const m = type.match(/^(\d+)([mHDWM])$/);
  if (!m) return 86_400;
  const n = Number(m[1]);
  const unit = m[2];
  const base = unit === "m" ? 60 : unit === "H" ? 3_600 : unit === "D" ? 86_400 : unit === "W" ? 604_800 : 2_592_000;
  return n * base;
}

async function withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function timeoutOrError(e: unknown): { ok: false; err: WrapperError } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(msg))) {
    return { ok: false, err: { kind: "timeout", status: 504, message: "upstream timeout" } };
  }
  return { ok: false, err: { kind: "upstream_error", status: 502, message: msg } };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
