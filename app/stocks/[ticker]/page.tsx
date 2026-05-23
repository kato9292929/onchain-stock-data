import Link from "next/link";
import { notFound } from "next/navigation";
import { getStocks } from "@/lib/data";
import { DataBanner } from "../../components/data-banner";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtBig = (n: number) => {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  return fmtUsd(n);
};
const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2) + "%";

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const data = await getStocks();
  const stock = data.stocks.find(
    (s) => s.underlying_ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!stock) notFound();

  return (
    <div className="space-y-6">
      <Link href="/stocks" className="text-xs text-zinc-500">
        ← back to /stocks
      </Link>

      <header className="space-y-1">
        <h1 className="text-3xl font-bold text-cyan-300">
          {stock.underlying_ticker}
        </h1>
        <div className="text-zinc-100">{stock.company_name}</div>
        <div className="text-xs text-zinc-500">{stock.listing_market}</div>
      </header>

      <DataBanner
        source={data.source}
        note={data.note}
        updatedAt={data.updated_at}
      />

      <section className="terminal-card p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-zinc-500 text-xs">price</div>
          <div className="text-zinc-100 font-bold">
            {fmtUsd(stock.price_usd)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">24h</div>
          <div
            className={
              stock.price_change_24h_pct >= 0
                ? "text-emerald-400"
                : "text-rose-400"
            }
          >
            {fmtPct(stock.price_change_24h_pct)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">7d</div>
          <div
            className={
              stock.price_change_7d_pct >= 0
                ? "text-emerald-400"
                : "text-rose-400"
            }
          >
            {fmtPct(stock.price_change_7d_pct)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">30d</div>
          <div
            className={
              stock.price_change_30d_pct >= 0
                ? "text-emerald-400"
                : "text-rose-400"
            }
          >
            {fmtPct(stock.price_change_30d_pct)}
          </div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">market cap</div>
          <div>{fmtBig(stock.market_cap_usd)}</div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">volume 24h</div>
          <div>{fmtBig(stock.volume_24h_usd)}</div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs">next earnings</div>
          <div>{stock.earnings_next_date ?? "n/a"}</div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Tokenized versions</h2>
        {stock.tokenized_versions.length === 0 && (
          <p className="text-sm text-zinc-500">No tokenized version yet.</p>
        )}
        {stock.tokenized_versions.map((t) => (
          <div key={t.token_symbol} className="terminal-card p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-cyan-300 font-bold">{t.token_symbol}</div>
              <div className="text-zinc-100 font-bold">
                {fmtUsd(t.current_price_usd)}
              </div>
            </div>
            <div className="text-xs text-zinc-400 space-y-1">
              <div>
                <span className="text-zinc-500">issuer:</span> {t.issuer}
              </div>
              <div>
                <span className="text-zinc-500">chain:</span> {t.chain}
              </div>
              <div className="font-mono break-all">
                <span className="text-zinc-500">mint:</span> {t.mint_address}
              </div>
              <div>
                <span className="text-zinc-500">vol 24h:</span>{" "}
                {fmtBig(t.volume_24h_usd)}
              </div>
              <div>
                <span className="text-zinc-500">venues:</span>{" "}
                {t.venues.join(" · ")}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
