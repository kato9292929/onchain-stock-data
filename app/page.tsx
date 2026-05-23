import Link from "next/link";

const FEATURES = [
  {
    href: "/stocks",
    title: "Stocks",
    blurb: "xStocks 60+ — mint addresses, prices, equity financials.",
  },
  {
    href: "/ipo",
    title: "IPO",
    blurb:
      "Backpack IPOs Onchain calendar — SPCX (SpaceX), Stripe, more (Superstate × Solana).",
  },
  {
    href: "/liquidity",
    title: "Liquidity",
    blurb:
      "Jupiter / Raydium / Orca pools — official vs DEX price deviation, arb signals.",
  },
  {
    href: "/holders",
    title: "Holders",
    blurb: "Helius-derived holder maps and concentration scores per xStock.",
  },
  {
    href: "/alpha",
    title: "Alpha",
    blurb: "Owner-curated X posts on tokenized equities.",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Onchain Stock Data
        </h1>
        <p className="text-zinc-400 max-w-2xl">
          Solana 上の株式トークン (xStocks) と Backpack IPOs Onchain の情報を
          統合した API + Web ページ。ブラウザからは無料で読めて、エージェント
          (Claude / GPT / curl / Python) からは{" "}
          <span className="text-cyan-400">x402</span> で $0.01 / call の有料
          エンドポイントになります。
        </p>
        <div className="flex flex-wrap gap-2 text-xs pt-2">
          <span className="px-2 py-1 rounded border border-zinc-800 text-zinc-400">
            Solana
          </span>
          <span className="px-2 py-1 rounded border border-zinc-800 text-zinc-400">
            xStocks (Backed Finance)
          </span>
          <span className="px-2 py-1 rounded border border-zinc-800 text-zinc-400">
            Backpack IPOs Onchain
          </span>
          <span className="px-2 py-1 rounded border border-zinc-800 text-zinc-400">
            x402 · Base USDC / Solana USDC
          </span>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="terminal-card p-4 hover:no-underline block"
          >
            <div className="text-cyan-300 font-bold text-sm mb-1">{f.href}</div>
            <div className="text-zinc-100 text-lg font-semibold mb-1">
              {f.title}
            </div>
            <div className="text-zinc-400 text-sm">{f.blurb}</div>
          </Link>
        ))}
      </section>

      <section className="terminal-card p-5 space-y-3">
        <h2 className="text-lg font-bold text-zinc-100">API</h2>
        <p className="text-sm text-zinc-400">
          All endpoints below return JSON. Programmatic clients receive an HTTP
          402 challenge per the{" "}
          <a href="https://x402.org" className="text-cyan-400">
            x402
          </a>{" "}
          spec; humans on this site get free reads.
        </p>
        <pre className="text-xs text-zinc-300 bg-black/60 border border-zinc-800 rounded p-3 overflow-x-auto">
{`GET /api/stocks                 # full xStocks registry
GET /api/stocks?tokenized=true  # tokenized-only
GET /api/stocks/:ticker         # single ticker (NVDA, TSLA, …)
GET /api/ipo                    # Backpack IPOs Onchain calendar
GET /api/liquidity              # DEX pools + price deviation
GET /api/holders                # holder maps + concentration
GET /api/alpha-posts            # curated X posts`}
        </pre>
      </section>
    </div>
  );
}
