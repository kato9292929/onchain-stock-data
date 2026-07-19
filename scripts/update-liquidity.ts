/**
 * Daily liquidity update — authoritative runner (GitHub Actions / local).
 * Calls lib/jobs.runLiquidityUpdate(), which fetches real DEX liquidity from
 * tokens.xyz and writes data/liquidity.json. The workflow then git-commits it.
 *
 * Run: npm run update:liquidity   (npx tsx scripts/update-liquidity.ts)
 * Requires TOKENS_XYZ_API_KEY in the environment.
 */
import { runLiquidityUpdate } from "@/lib/jobs";

async function main() {
  const res = await runLiquidityUpdate();
  if (!res.ok) {
    console.error(`[update:liquidity] FAILED: ${res.error ?? res.persist_reason}`);
    process.exit(1);
  }
  console.log(
    `[update:liquidity] universe=${res.universe} enriched=${res.enriched} pairs=${res.pairs} — wrote data/liquidity.json`,
  );
}

main().catch((e) => {
  console.error("[update:liquidity] crashed:", e);
  process.exit(1);
});
