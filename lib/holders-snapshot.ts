import { getCuratedStocks } from "@/lib/tokensXyz";
import {
  getTokenHolders,
  getTokenOverview,
  type BirdeyeHolderItem,
  type BirdeyeOverview,
} from "@/lib/birdeye";
import type { HoldersFile, HoldersToken, HolderEntry } from "@/lib/data";

/**
 * Build a real on-chain holders snapshot from Birdeye, for the daily
 * update-holders cron. The xStock universe (mints + symbols) comes from the
 * same tokens.xyz curated list the liquidity job uses; per-mint holder
 * distribution + supply come from Birdeye.
 *
 * The mapping helpers are pure so they can be unit-tested without network; the
 * orchestration is serial (Birdeye throttles internally to respect the 60 rpm
 * account cap) and skips any token whose fetch fails rather than aborting.
 */

/** Top-N holders kept per token. */
const TOP_HOLDERS = 20;
/** How many tokens to snapshot per run (bounds runtime under the rate cap). */
const MAX_TOKENS = 100;

/** ui balance for a Birdeye holder item, tolerating field-name variance. */
export function holderUiAmount(item: BirdeyeHolderItem): number {
  if (typeof item.ui_amount === "number") return item.ui_amount;
  if (typeof item.uiAmount === "number") return item.uiAmount;
  const raw = typeof item.amount === "string" ? Number(item.amount) : item.amount;
  if (typeof raw === "number" && typeof item.decimals === "number") {
    return raw / 10 ** item.decimals;
  }
  return typeof raw === "number" ? raw : 0;
}

/** Circulating (preferred) or total supply from an overview, in UI units. */
export function overviewSupply(o: BirdeyeOverview | null): number {
  if (!o) return 0;
  return o.circulatingSupply ?? o.supply ?? 0;
}

/** Holder count from an overview, tolerating `holder` / `holders`. */
export function overviewHolderCount(o: BirdeyeOverview | null): number {
  if (!o) return 0;
  return o.holder ?? o.holders ?? 0;
}

/** Ranked top holders with pct-of-supply. Sorted desc, capped at TOP_HOLDERS. */
export function toHolderEntries(
  items: BirdeyeHolderItem[],
  totalSupply: number,
): HolderEntry[] {
  const rows = items
    .map((it) => ({ address: it.owner ?? it.address ?? it.token_account ?? "", bal: holderUiAmount(it) }))
    .filter((r) => r.address && r.bal > 0)
    .sort((a, b) => b.bal - a.bal)
    .slice(0, TOP_HOLDERS);
  return rows.map((r, i) => ({
    rank: i + 1,
    address: r.address,
    balance: Number(r.bal.toFixed(4)),
    pct: totalSupply > 0 ? Number(((r.bal / totalSupply) * 100).toFixed(2)) : 0,
    label: "",
  }));
}

/**
 * Concentration = combined share of the top 10 holders (0–1), with a label.
 * Mirrors the scale in the sample data (~0.42 → "moderate").
 */
export function concentration(top: HolderEntry[]): {
  score: number;
  label: string;
} {
  const share = top.slice(0, 10).reduce((s, h) => s + h.pct, 0) / 100;
  const score = Number(share.toFixed(2));
  const label = score >= 0.66 ? "high" : score >= 0.33 ? "moderate" : "low";
  return { score, label };
}

export interface HolderTokenInput {
  symbol: string;
  mint: string;
  holders: BirdeyeHolderItem[];
  overview: BirdeyeOverview | null;
}

/** Assemble one HoldersToken from a token's Birdeye responses. */
export function assembleHoldersToken(input: HolderTokenInput): HoldersToken {
  const totalSupply = overviewSupply(input.overview);
  const top = toHolderEntries(input.holders, totalSupply);
  const { score, label } = concentration(top);
  const sym = input.symbol.toUpperCase();
  return {
    token_symbol: sym.endsWith("X") ? sym : `${sym}x`,
    underlying_ticker: sym,
    mint_address: input.mint,
    holder_count: overviewHolderCount(input.overview),
    total_supply: Number(totalSupply.toFixed(2)),
    concentration_score: score,
    concentration_label: label,
    top_holders: top,
  };
}

export interface HoldersSnapshotResult {
  file: HoldersFile;
  universe: number;
  fetched: number;
}

export async function buildHoldersSnapshot(): Promise<HoldersSnapshotResult> {
  const curated = await getCuratedStocks();
  const items = curated?.items ?? curated?.stocks ?? [];

  const targets = items
    .map((it) => ({
      symbol: it.symbol ?? it.asset?.symbol ?? it.assetId ?? "",
      mint: it.primaryVariant?.mint ?? "",
    }))
    .filter((t) => t.symbol && t.mint);

  if (targets.length > MAX_TOKENS) {
    console.warn(`[update:holders] universe ${targets.length} > cap ${MAX_TOKENS}; snapshotting first ${MAX_TOKENS}.`);
  }
  const capped = targets.slice(0, MAX_TOKENS);

  const tokens: HoldersToken[] = [];
  for (const t of capped) {
    try {
      const [holders, overview] = [
        await getTokenHolders(t.mint, { limit: 100 }),
        await getTokenOverview(t.mint),
      ];
      if (!holders?.items?.length) {
        console.warn(`[update:holders] ${t.symbol} (${t.mint}) — no holders returned, skipping`);
        continue;
      }
      tokens.push(
        assembleHoldersToken({
          symbol: t.symbol,
          mint: t.mint,
          holders: holders.items,
          overview,
        }),
      );
    } catch (err) {
      console.error(`[update:holders] ${t.symbol} failed:`, err);
    }
  }

  const file: HoldersFile = {
    source: "birdeye",
    note: "Daily on-chain holder distribution for xStock tokens, from Birdeye Data Services (Solana).",
    updated_at: new Date().toISOString(),
    tokens,
  };
  return { file, universe: targets.length, fetched: tokens.length };
}
