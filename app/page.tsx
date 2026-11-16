import Link from "next/link";
import { LandingHero } from "./components/landing-hero";
import { SolanaStocksSection } from "./components/solana-stocks-section";
import { loadSummaries } from "@/lib/solana-stocks-load";
import { getThemes } from "@/lib/themes";
import { SolanaMark } from "./components/solana-mark";
import { PER_CALL_PRICE } from "@/lib/x402";

export const dynamic = "force-dynamic";

/**
 * The front page: the hero, every tokenized stock with its condition and
 * verdict, then how agents pay (x402) and read (MCP). Themes, Catalysts and the
 * selection are tabs in the hero's nav, not sections here.
 */
export default async function Home() {
  const [solana, themes] = await Promise.all([loadSummaries().catch(() => null), getThemes()]);

  return (
    <div className="font-inter min-h-screen bg-[#f9fafb] text-slate-900">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <LandingHero solanaCount={solana?.rows.length ?? 0} themeCount={themes?.themes.length ?? 0} pricePerCall={PER_CALL_PRICE.usdc} intro />

        {/* x402 — the payment rail. Every paid call settles on Solana. */}
        <section id="x402" className="mt-16">
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Agents
            </div>
            <h2 className="font-outfit flex flex-wrap items-center gap-3 text-2xl font-semibold text-[#0a1b33]">
              Pay per call on
              <span className="inline-flex items-center gap-2">
                <SolanaMark className="h-[0.8em] w-auto" title={null} />
                <span className="bg-gradient-to-r from-[#00FFA3] to-[#DC1FFF] bg-clip-text text-transparent">
                  Solana
                </span>
              </span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              No account, no API key, no subscription. An agent calls a paid
              endpoint, gets an HTTP <span className="font-semibold text-slate-700">402</span>,
              signs a USDC payment and retries — settled onchain in about a
              second. <span className="font-semibold text-slate-700">USDC on Solana is the only rail</span>:
              the facilitator sponsors the gas, so the buyer never needs SOL.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#0a152d] shadow-sm">
            <div className="h-1 w-full bg-gradient-to-r from-[#00FFA3] to-[#DC1FFF]" />
            <div className="grid gap-px bg-white/10 sm:grid-cols-2">
              {[
                {
                  price: `${PER_CALL_PRICE.usdc} USDC`,
                  unit: "per call",
                  what: "Per-company data: SEC filings & financials, Japan large-holding reports",
                  detail: "/api/solana-stocks/{ticker}?view=full · /api/edinet/{code} (large holdings)",
                },
                {
                  price: "$0.01",
                  unit: "per call",
                  what: "Selection: conditions, verdicts, hit rate",
                  detail: "/api/alpha/… — the weekly picks and how each condition was judged",
                },
              ].map((row) => (
                <div key={row.what} className="bg-[#0a152d] p-6">
                  <div className="flex items-baseline gap-2">
                    <span className="font-outfit text-2xl font-semibold text-white tabular-nums">
                      {row.price}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">
                      {row.unit}
                    </span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-white/90">{row.what}</div>
                  <code className="mt-1 block font-mono text-[11px] leading-relaxed text-slate-400">
                    {row.detail}
                  </code>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 px-6 py-4 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <SolanaMark className="h-3 w-auto" title={null} />
                USDC-SPL · <code className="font-mono">exact</code> · mainnet
              </span>
              <span>Gas sponsored — no SOL needed</span>
              <span>404s are never charged</span>
              <Link
                href="/.well-known/x402.json"
                className="font-semibold text-white! hover:underline"
              >
                /.well-known/x402.json →
              </Link>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Reading is free — the pages above, and the MCP tools below, need no
            payment and no signature.
          </p>
        </section>

        {/* MCP — talk to the research */}
        <section id="mcp" className="mt-16">
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Developers
            </div>
            <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">
              MCP · read the data
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              osd ships a remote <span className="font-semibold text-slate-700">MCP server</span>.
              Connect it to Claude, Cursor or any MCP client to look up a tokenized stock
              and the Selection record in plain language. Every tool is read-only and
              free — no model call runs on a tool invocation. The per-company filings and
              financials are the paid endpoints above.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* tools */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Tools
              </div>
              <ul className="mt-3 space-y-3">
                {[
                  ["solana_stock_get", "A tokenized stock on Solana — mints, issuer, next earnings and its per-call URL."],
                  ["portfolio_get", "This week's Selection (US / Japan) — picks, weights and each pick's condition."],
                  ["catalysts_list", "Every condition with its deadline and verdict; filter by date range, ticker or category."],
                  ["themes_list", "The Selection categories (weekly, neocloud, physical AI, Japan sectors) and their members."],
                  ["theme_get", "One category's members — next earnings, current condition, Solana token."],
                  ["scoreboard_get", "HIT / PARTIAL / MISS tally for the Physical AI category."],
                  ["neocloud_theme", "Neocloud companies (US 18 / Japan 5): contracted and energized MW, next earnings."],
                  ["neocloud_company", "One neocloud company's latest disclosed numbers, each with its filing."],
                  ["neocloud_digest", "Neocloud companies with a filing in the last 7 days."],
                ].map(([name, desc]) => (
                  <li key={name} className="flex flex-col gap-0.5">
                    <code className="break-all font-mono text-[13px] font-semibold text-[#0a1b33]">{name}</code>
                    <span className="text-[13px] text-slate-500">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* connect */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Connect
              </div>
              <p className="mt-3 text-[13px] text-slate-500">Endpoint (streamable HTTP)</p>
              <pre className="mt-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-700">
                <code>https://osd.x402jp.com/api/mcp</code>
              </pre>
              <p className="mt-3 text-[13px] text-slate-500">Claude Code / CLI</p>
              <pre className="mt-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-700">
                <code>{`claude mcp add --transport http onchain-stock-data https://osd.x402jp.com/api/mcp`}</code>
              </pre>
              <p className="mt-3 text-[13px] text-slate-500">Or client config</p>
              <pre className="mt-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
                <code>{`{
  "mcpServers": {
    "onchain-stock-data": {
      "type": "http",
      "url": "https://osd.x402jp.com/api/mcp"
    }
  }
}`}</code>
              </pre>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            MCP reads are free. The paid endpoints above settle per call in USDC on Solana.
          </p>
        </section>

        {/* Stocks: five rows here, the full list in the Stocks tab */}
        <section className="mt-16">
          <SolanaStocksSection preview={5} />
        </section>

        <footer className="mt-16 border-t border-slate-200 py-8 text-xs text-slate-400">
          <p>
            Informational only — not investment advice. Data comes from the companies&apos; own
            filings (SEC EDGAR, EDINET, TDnet); no market prices are used.
          </p>
          <p className="mt-2">
            <a href="https://github.com/kato9292929/onchain-stock-data" className="text-slate-500 hover:text-slate-700">
              github.com/kato9292929/onchain-stock-data
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
