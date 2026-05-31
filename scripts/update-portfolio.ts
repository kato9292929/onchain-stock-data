/**
 * Weekly portfolio update — authoritative runner (GitHub Actions / local).
 * Calls lib/jobs.runPortfolioUpdate() directly (no HTTP, no /api/predict),
 * which writes data/portfolio-history.json. The workflow then git-commits it.
 *
 * Run: npm run update:portfolio   (npx tsx scripts/update-portfolio.ts)
 */
import { runPortfolioUpdate } from "@/lib/jobs";

async function main() {
  const res = await runPortfolioUpdate({ horizon: "1m" });
  if (!res.ok) {
    console.error("[update:portfolio] selection failed:", res.error);
    process.exit(1);
  }
  console.log(
    `[update:portfolio] week_of=${res.week_of} holdings=${res.portfolio?.holdings.length} changes=${res.portfolio?.changes?.length ?? 0}`,
  );
  if (!res.persisted) {
    console.error("[update:portfolio] FAILED to write data file:", res.persist_reason);
    process.exit(1);
  }
  console.log("[update:portfolio] wrote data/portfolio-history.json");
}

main().catch((e) => {
  console.error("[update:portfolio] unexpected error:", e);
  process.exit(1);
});
