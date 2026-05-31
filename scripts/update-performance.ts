/**
 * Daily performance update — authoritative runner (GitHub Actions / local).
 * Calls lib/jobs.runPerformanceUpdate() directly, which writes
 * data/performance-history.json. The workflow then git-commits it.
 *
 * Run: npm run update:performance   (npx tsx scripts/update-performance.ts)
 */
import { runPerformanceUpdate } from "@/lib/jobs";

async function main() {
  const res = await runPerformanceUpdate();
  console.log(
    `[update:performance] date=${res.date} portfolio=${res.record?.portfolio_index} spy=${res.record?.spy_index} qqq=${res.record?.qqq_index}`,
  );
  if (!res.persisted) {
    console.error("[update:performance] FAILED to write data file:", res.persist_reason);
    process.exit(1);
  }
  console.log("[update:performance] wrote data/performance-history.json");
}

main().catch((e) => {
  console.error("[update:performance] unexpected error:", e);
  process.exit(1);
});
