import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortfolioHistory, getStockByTicker } from "@/lib/data";

const fmtUsd = (n?: number | null) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";

export default async function PortfolioTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const data = await getPortfolioHistory();
  const holding = data.current?.holdings.find((h) => h.ticker === upper);
  if (!holding) notFound();

  const stock = await getStockByTicker(upper).catch(() => null);
  const currentPrice = stock?.price_usd ?? null;
  const entry = holding.entry_price_usd ?? null;
  const changePct =
    currentPrice && entry ? ((currentPrice - entry) / entry) * 100 : null;

  return (
    <div className="space-y-6">
      <Link href="/alpha/portfolio" className="text-xs text-zinc-500">
        ← Claude Portfolio
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          <span className="text-cyan-300">{holding.ticker}</span>{" "}
          <span className="text-zinc-400 text-lg">{holding.company_name}</span>
        </h1>
        <p className="text-xs text-zinc-500">
          weight {holding.weight.toFixed(1)}% · week of {data.current?.week_of}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="terminal-card p-4">
          <p className="text-xs text-zinc-500">entry price</p>
          <p className="text-lg text-zinc-100">{fmtUsd(entry)}</p>
        </div>
        <div className="terminal-card p-4">
          <p className="text-xs text-zinc-500">current price</p>
          <p className="text-lg text-zinc-100">{fmtUsd(currentPrice)}</p>
        </div>
        <div className="terminal-card p-4">
          <p className="text-xs text-zinc-500">since entry</p>
          <p
            className={`text-lg ${
              changePct == null
                ? "text-zinc-500"
                : changePct >= 0
                  ? "text-emerald-400"
                  : "text-red-400"
            }`}
          >
            {changePct == null ? "—" : fmtPct(changePct)}
          </p>
        </div>
      </div>

      <div className="terminal-card p-4">
        <p className="text-xs text-zinc-500 mb-2">Claude thesis</p>
        <p className="text-sm text-zinc-200">{holding.thesis}</p>
      </div>

      <p className="text-xs text-zinc-600">
        本ポートフォリオは Claude による情報提供であり投資助言ではありません。
        current price は osd の /api/stocks (tokens.xyz 経由) を参照しています。
      </p>
    </div>
  );
}
