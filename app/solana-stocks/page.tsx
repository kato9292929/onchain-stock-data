import Link from "next/link";
import { SolanaStocksSection } from "../components/solana-stocks-section";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every tokenized stock on Solana — the same section the front page shows. */
export default async function SolanaStocksPage() {
  return (
    <div className="space-y-8">
      <SolanaStocksSection />
      <p className="text-xs text-slate-400">
        Informational only — not investment advice. No market prices are shown or used.{" "}
        <Link href="/" className="text-slate-500 underline">
          Home
        </Link>
      </p>
    </div>
  );
}
