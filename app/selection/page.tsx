import { loadRecords, loadSummaries } from "@/lib/solana-stocks-load";
import { selectionRows } from "@/lib/selection";
import { PER_CALL_PRICE } from "@/lib/x402";
import { SelectionTable } from "./selection-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Selection: every condition this site has set, one list (formerly Selection / Catalysts / Themes). */
export default async function SelectionPage() {
  const [rec, stocks] = await Promise.all([loadRecords().catch(() => null), loadSummaries().catch(() => null)]);
  if (!rec) return <p className="p-8 text-sm text-slate-400">Couldn&apos;t load the record.</p>;
  const pages = new Set((stocks?.rows ?? []).map((s) => s.ticker.toUpperCase()));
  const rows = selectionRows(rec, new Date().toISOString().slice(0, 10)).map((r) => ({ ...r, has_page: pages.has(r.ticker.toUpperCase()) }));

  return (
    <div className="font-inter space-y-8">
      <header className="space-y-3">
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">Selection</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Every condition set on a US or Japanese stock: a number, a threshold and a deadline, judged HIT / PARTIAL / MISS
          against the company&apos;s own filing. One stock&apos;s full record is{" "}
          <span className="font-semibold text-slate-700">{PER_CALL_PRICE.usdc} USDC per call</span> over x402.
        </p>
      </header>
      <SelectionTable rows={rows} />
    </div>
  );
}
