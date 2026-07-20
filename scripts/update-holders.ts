/**
 * Daily holders update — authoritative runner (GitHub Actions / local).
 * Calls lib/jobs.runHoldersUpdate(), which fetches real on-chain holder
 * distribution from Birdeye and writes data/holders.json. The workflow then
 * git-commits it.
 *
 * Run: npm run update:holders   (npx tsx scripts/update-holders.ts)
 * Requires BIRDEYE_API_KEY (and TOKENS_XYZ_API_KEY for the mint universe).
 */
import { runHoldersUpdate } from "@/lib/jobs";

async function main() {
  const res = await runHoldersUpdate();
  if (!res.ok) {
    console.error(`[update:holders] FAILED: ${res.error ?? res.persist_reason}`);
    process.exit(1);
  }
  console.log(
    `[update:holders] universe=${res.universe} fetched=${res.fetched} — wrote data/holders.json`,
  );
}

main().catch((e) => {
  console.error("[update:holders] crashed:", e);
  process.exit(1);
});
