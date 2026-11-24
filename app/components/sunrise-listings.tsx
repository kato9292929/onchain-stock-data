import { getSolanaStocks } from "@/lib/solana-stocks";
import { sunriseListings, SUNRISE_SOURCE } from "@/lib/sunrise";
import { fetchActivity } from "@/lib/onchain-activity";
import { SunriseTable, type SunriseRow } from "./sunrise-table";

/**
 * The tokenized stocks listed on Solana via Sunrise (Wormhole Labs), newest
 * first, with each one's onchain activity (Jupiter, cached 15 minutes). The
 * list comes from Sunrise's own app page, read weekly; activity is optional and
 * the rows still show if Jupiter is unreachable.
 */
export async function SunriseListings({ preview = 10 }: { preview?: number }) {
  const file = await getSolanaStocks().catch(() => null);
  if (!file) return null;
  const list = sunriseListings(file);
  if (list.length === 0) return null;
  const act = await fetchActivity(list.slice(0, 100).map((l) => l.mint)).catch(() => null);
  const rows: SunriseRow[] = list.map((l) => {
    const a = act?.get(l.mint);
    return { ...l, volume_24h_usd: a?.volume_24h_usd ?? null, holders: a?.holders ?? null };
  });
  const latest = list[0];

  return (
    <div className="font-inter">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sunrise · listings on Solana</div>
          <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">Listed via Sunrise</h2>
        </div>
        <span className="text-[12px] text-slate-500">
          {list.length} stocks issued by Backpack Securities · latest{" "}
          <span className="font-semibold text-[#0a1b33]">
            {latest.ticker} ({latest.listed_at})
          </span>
        </span>
      </div>
      <SunriseTable rows={rows} preview={preview} />
      <p className="mt-2 text-[11px] text-slate-400">
        Listings: Sunrise&apos;s own list ({SUNRISE_SOURCE}), each mint checked on-chain as Backpack Securities&apos;. 24h volume and
        holders: Jupiter&apos;s public token API — market activity, not used to judge any condition.
      </p>
    </div>
  );
}
