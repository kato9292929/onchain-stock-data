/**
 * On-chain trading activity of the tokenized stocks on Solana: 24-hour volume,
 * trades, traders and holders per mint, from Jupiter's public token API
 * (lite-api.jup.ag, free, no key). This is market activity, not a price
 * signal: nothing here is used to judge a condition.
 *
 * Two kinds of read, one request each, cached for 15 minutes (the free API
 * rate-limits bursts, so nothing here fans out):
 *   - the top 100 tokens on all of Solana by 24h volume, kept where the mint is
 *     one of the tokenized stocks — what is trending;
 *   - up to 100 given mints — one stock's tokens, for a brief.
 */
import type { SolanaStocksFile } from "@/lib/solana-stocks";

export const ONCHAIN_SOURCE = "Jupiter token API (lite-api.jup.ag), 24h window";
const BASE = "https://lite-api.jup.ag/tokens/v2";
const CACHE_SECONDS = 15 * 60;
const NEW_DAYS = 30;

interface JupToken {
  id: string;
  symbol?: string;
  holderCount?: number;
  liquidity?: number;
  organicScore?: number;
  firstPool?: { createdAt?: string };
  stats24h?: {
    buyVolume?: number;
    sellVolume?: number;
    numBuys?: number;
    numSells?: number;
    numTraders?: number;
    holderChange?: number;
    volumeChange?: number;
  };
}

export interface MintActivity {
  mint: string;
  holders: number | null;
  volume_24h_usd: number;
  trades_24h: number;
  traders_24h: number;
  /** % change in holders over 24h. */
  holder_change_24h_pct: number | null;
  liquidity_usd: number | null;
  first_pool_at: string | null;
}

/** One Jupiter token → our fields. Pure. */
export function activityOf(t: JupToken): MintActivity {
  const s = t.stats24h ?? {};
  return {
    mint: t.id,
    holders: t.holderCount ?? null,
    volume_24h_usd: Math.round((s.buyVolume ?? 0) + (s.sellVolume ?? 0)),
    trades_24h: (s.numBuys ?? 0) + (s.numSells ?? 0),
    traders_24h: s.numTraders ?? 0,
    holder_change_24h_pct: s.holderChange == null ? null : Number(s.holderChange.toFixed(2)),
    liquidity_usd: t.liquidity == null ? null : Math.round(t.liquidity),
    first_pool_at: t.firstPool?.createdAt ?? null,
  };
}

async function jupGet(url: string): Promise<JupToken[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "onchain-stock-data (+https://osd-coral.vercel.app)" },
      next: { revalidate: CACHE_SECONDS },
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }
    if (!res.ok) throw new Error(`Jupiter ${res.status}`);
    const j = await res.json();
    return Array.isArray(j) ? (j as JupToken[]) : [];
  }
}

/** The top 100 tokens on Solana by 24h volume, as activity. Throws if Jupiter is unreachable. */
export async function fetchTopTraded(): Promise<Map<string, MintActivity>> {
  const list = await jupGet(`${BASE}/toptraded/24h?limit=100`);
  return new Map(list.map((t) => [t.id, activityOf(t)]));
}

/** Activity for up to 100 given mints (unknown mints are absent). Throws if Jupiter is unreachable. */
export async function fetchActivity(mints: string[]): Promise<Map<string, MintActivity>> {
  if (mints.length === 0) return new Map();
  if (mints.length > 100) throw new Error("fetchActivity takes at most 100 mints");
  const wanted = new Set(mints);
  const list = await jupGet(`${BASE}/search?query=${mints.join(",")}`);
  return new Map(list.filter((t) => wanted.has(t.id)).map((t) => [t.id, activityOf(t)]));
}

export interface TickerActivity {
  ticker: string;
  name: string;
  volume_24h_usd: number;
  trades_24h: number;
  traders_24h: number;
  holders: number;
  /** The issuer token with the most volume. */
  top_issuer: string;
  /** Newest first pool among its tokens, when within 30 days: a new listing. */
  new_listing_since: string | null;
  holder_change_24h_pct: number | null;
  tokens: Array<{ issuer: string; symbol: string; mint: string; volume_24h_usd: number; holders: number | null }>;
}

/**
 * Per underlying ticker: every issuer's token added up, ranked by 24h volume;
 * the volume by issuer; and the new listings. Over whatever activity is given
 * (for trending: the stocks among Solana's top 100). Pure.
 */
export function rankActivity(file: SolanaStocksFile, act: Map<string, MintActivity>, now: Date, shortIssuer: (s: string) => string) {
  const byTicker = new Map<string, TickerActivity>();
  const byIssuer: Record<string, number> = {};
  const cutoff = new Date(now.getTime() - NEW_DAYS * 86_400_000).toISOString();
  for (const t of file.tokens) {
    const a = act.get(t.solana_mint);
    if (!a) continue;
    const issuer = shortIssuer(t.issuer);
    byIssuer[issuer] = (byIssuer[issuer] ?? 0) + a.volume_24h_usd;
    const cur =
      byTicker.get(t.ticker) ??
      ({ ticker: t.ticker, name: t.name, volume_24h_usd: 0, trades_24h: 0, traders_24h: 0, holders: 0, top_issuer: issuer, new_listing_since: null, holder_change_24h_pct: null, tokens: [] } as TickerActivity);
    cur.volume_24h_usd += a.volume_24h_usd;
    cur.trades_24h += a.trades_24h;
    cur.traders_24h += a.traders_24h;
    cur.holders += a.holders ?? 0;
    cur.tokens.push({ issuer, symbol: t.symbol, mint: t.solana_mint, volume_24h_usd: a.volume_24h_usd, holders: a.holders });
    const top = cur.tokens.reduce((x, y) => (y.volume_24h_usd > x.volume_24h_usd ? y : x));
    cur.top_issuer = top.issuer;
    if (a.volume_24h_usd === top.volume_24h_usd) cur.holder_change_24h_pct = a.holder_change_24h_pct;
    // A ticker is new only if none of its tokens traded before the cutoff.
    const firsts = cur.tokens.map((x) => act.get(x.mint)?.first_pool_at).filter(Boolean) as string[];
    const earliest = firsts.sort()[0] ?? null;
    cur.new_listing_since = earliest && earliest >= cutoff ? earliest : null;
    byTicker.set(t.ticker, cur);
  }
  const ranked = [...byTicker.values()].sort((a, b) => b.volume_24h_usd - a.volume_24h_usd);
  const total = Object.values(byIssuer).reduce((a, b) => a + b, 0);
  return {
    source: ONCHAIN_SOURCE,
    as_of: now.toISOString(),
    total_volume_24h_usd: total,
    by_issuer: Object.entries(byIssuer)
      .sort((a, b) => b[1] - a[1])
      .map(([issuer, v]) => ({ issuer, volume_24h_usd: v, share: total ? Number((v / total).toFixed(4)) : 0 })),
    top: ranked,
    new_listings: ranked.filter((r) => r.new_listing_since),
  };
}
