/**
 * Phase 1 — fetch AA's aggregated external alt-data and format it for the
 * portfolio selection prompt.
 *
 * AA exposes `AA_EXTERNAL_DATA_URL` (e.g. /api/latest-external-data) which
 * returns per-ticker Birdeye OHLCV summaries + Perplexity news/catalyst
 * suggestions. This is best-effort: a 10s timeout and any failure degrade
 * gracefully to `null` so portfolio selection still runs without it.
 */

const TIMEOUT_MS = 10_000;

export interface ExternalBirdeyeSummary {
  ticker?: string;
  summary?: string;
  [k: string]: unknown;
}

export interface ExternalPerplexityEvent {
  ticker?: string;
  title?: string;
  date?: string;
  source_url?: string;
  catalyst_suggestion?: string;
  [k: string]: unknown;
}

export interface ExternalData {
  birdeye?: ExternalBirdeyeSummary[];
  perplexity?: ExternalPerplexityEvent[];
  [k: string]: unknown;
}

type FetchFn = typeof fetch;

/**
 * Fetch AA's external data. Returns null (never throws) on missing env,
 * timeout, non-2xx, or parse failure — the caller proceeds without it.
 */
export async function fetchExternalData(
  deps: { fetchImpl?: FetchFn; url?: string } = {},
): Promise<ExternalData | null> {
  const url = deps.url ?? process.env.AA_EXTERNAL_DATA_URL;
  if (!url) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[external-data] AA returned ${res.status} — degrading without it`);
      return null;
    }
    const data = (await res.json()) as ExternalData;
    return data && typeof data === "object" ? data : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[external-data] fetch failed (${msg}) — degrading without it`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render external data as a prompt context section. Returns "" when there is
 * nothing usable so the prompt is unchanged in the degraded path.
 */
export function formatExternalDataForPrompt(data: ExternalData | null): string {
  if (!data) return "";
  const birdeye = Array.isArray(data.birdeye) ? data.birdeye : [];
  const perplexity = Array.isArray(data.perplexity) ? data.perplexity : [];
  if (birdeye.length === 0 && perplexity.length === 0) return "";

  const lines: string[] = [
    "",
    "## External alt data (from AA via x402)",
    "",
    "### Birdeye OHLCV (past 30 days)",
  ];
  if (birdeye.length > 0) {
    for (const b of birdeye) {
      const t = b.ticker ?? "?";
      const s = b.summary ?? JSON.stringify(b);
      lines.push(`- ${t}: ${s}`);
    }
  } else {
    lines.push("(none)");
  }

  lines.push("", "### Perplexity recent news + catalyst suggestions");
  if (perplexity.length > 0) {
    for (const e of perplexity) {
      const t = e.ticker ?? "?";
      const title = e.title ?? "";
      const date = e.date ?? "";
      const cat = e.catalyst_suggestion ?? "";
      const src = e.source_url ?? "";
      lines.push(`- ${t}: ${title}${date ? ` (${date})` : ""}${cat ? ` — catalyst: ${cat}` : ""}${src ? ` [${src}]` : ""}`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");
  return lines.join("\n");
}
