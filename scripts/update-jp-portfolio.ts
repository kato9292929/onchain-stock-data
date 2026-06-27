/**
 * Weekly JP portfolio update — authoritative runner (GitHub Actions / local).
 * Calls lib/jobs.runJpPortfolioUpdate() directly, which writes
 * data/jp-portfolio-history.json. The workflow then git-commits it. Mirror of
 * scripts/update-portfolio.ts.
 *
 * Run: npm run update:jp-portfolio   (npx tsx scripts/update-jp-portfolio.ts)
 */
import { runJpPortfolioUpdate } from "@/lib/jobs";

async function main() {
  const res = await runJpPortfolioUpdate({ horizon: "1m" });
  if (!res.ok) {
    console.error("[update:jp-portfolio] selection failed:", res.error);
    process.exit(1);
  }
  console.log(
    `[update:jp-portfolio] week_of=${res.week_of} holdings=${res.portfolio?.holdings.length} changes=${res.portfolio?.changes?.length ?? 0}`,
  );
  if (!res.persisted) {
    console.error("[update:jp-portfolio] FAILED to write data file:", res.persist_reason);
    process.exit(1);
  }
  console.log("[update:jp-portfolio] wrote data/jp-portfolio-history.json");
}

main().catch((e) => {
  console.error("[update:jp-portfolio] unexpected error:", e);
  process.exit(1);
});
