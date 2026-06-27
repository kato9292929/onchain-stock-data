import type { ExternalCatalyst } from "@/lib/data";

/**
 * Upstash Redis (REST) persistence for JP external catalysts.
 *
 * Vercel's serverless FS is ephemeral, so writes to data/external-catalysts.json
 * don't survive across instances — a submit on one node is invisible to a GET on
 * another. JP catalysts are therefore persisted in Upstash instead. We talk to
 * the same REST API the rest of the stack uses (no SDK), authenticated with a
 * Bearer token, so no extra dependency is added.
 *
 * Key design:
 *   catalyst:jp:{ticker}:{catalyst_id}  → JSON body of one catalyst (upserted)
 *   jp:catalysts                        → SET of those body-key strings
 *
 * Idempotency: re-putting the same catalyst SETs the same body key (overwrite)
 * and SADDs the same member (sets dedupe), so counts never grow on re-submit.
 */

const SET_KEY = "jp:catalysts";

type RedisReply = { result?: unknown; error?: unknown };

function env(): { url?: string; token?: string } {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

export function upstashConfigured(): boolean {
  const { url, token } = env();
  return Boolean(url && token);
}

export function bodyKey(ticker: string, catalystId: string): string {
  return `catalyst:jp:${ticker}:${catalystId}`;
}

/** Run a Redis command pipeline via the Upstash REST API. Throws on transport
 *  or per-command errors so callers can log and decide (never silently drop). */
async function pipeline(commands: string[][]): Promise<RedisReply[]> {
  const { url, token } = env();
  if (!url || !token) throw new Error("upstash not configured");
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`upstash pipeline ${res.status}: ${await res.text()}`);
  }
  const replies = (await res.json()) as RedisReply[];
  for (const r of replies) {
    if (r && r.error) throw new Error(`upstash command error: ${String(r.error)}`);
  }
  return replies;
}

/** Upsert one catalyst body key and add it to the jp:catalysts set. */
export async function putCatalyst(c: ExternalCatalyst): Promise<void> {
  const key = bodyKey(c.ticker, c.catalyst_id);
  await pipeline([
    ["SET", key, JSON.stringify(c)],
    ["SADD", SET_KEY, key],
  ]);
}

/** Read every JP catalyst body referenced by the jp:catalysts set. */
export async function listCatalysts(): Promise<ExternalCatalyst[]> {
  if (!upstashConfigured()) return [];
  const [membersReply] = await pipeline([["SMEMBERS", SET_KEY]]);
  const members = (membersReply?.result as string[] | undefined) ?? [];
  if (members.length === 0) return [];
  const [valuesReply] = await pipeline([["MGET", ...members]]);
  const values = (valuesReply?.result as Array<string | null> | undefined) ?? [];
  const out: ExternalCatalyst[] = [];
  for (const v of values) {
    if (!v) continue;
    try {
      out.push(JSON.parse(v) as ExternalCatalyst);
    } catch {
      // skip corrupt entry; the others still load.
    }
  }
  return out;
}

/** Fetch a single catalyst body, or null when absent. */
export async function getCatalyst(
  ticker: string,
  catalystId: string,
): Promise<ExternalCatalyst | null> {
  if (!upstashConfigured()) return null;
  const [reply] = await pipeline([["GET", bodyKey(ticker, catalystId)]]);
  const v = reply?.result as string | null | undefined;
  if (!v) return null;
  try {
    return JSON.parse(v) as ExternalCatalyst;
  } catch {
    return null;
  }
}
