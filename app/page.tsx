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
        <LandingHero solanaCount={solana?.rows.length ?? 0} themeCount={themes?.themes.length ?? 0} intro />

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
                  what: "Portfolio & catalyst scoring",
                  detail: "/api/alpha/… — selections, hit-rate, catalyst verdicts",
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
              MCP · call the research
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              osd ships a remote <span className="font-semibold text-slate-700">MCP server</span>.
              Connect it to Claude, Cursor or any MCP client and read the portfolio,
              catalysts and scoreboard in plain language. Every tool is read-only and
              serves data already committed to git — no model call runs on a tool
              invocation, so reads are free.
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
                  ["portfolio_get", "Current US / JP selection — weights, thesis, catalyst dates."],
                  ["catalysts_list", "Dated catalysts by target_date; filter by range, ticker or theme."],
                  ["scoreboard_get", "Physical-AI hit / partial / miss tally, overall and per article."],
                  ["signal_get", "Directional signals by ticker / theme (paid x402 testnet twin)."],
                  ["solana_stock_get", "A tokenized stock on Solana — mints, next earnings, conditions, per-call URL."],
                  ["neocloud_theme", "The neocloud theme (US 18 / JP 5): next earnings and each company's contracted and energized MW."],
                  ["neocloud_company", "One neocloud company's latest disclosed numbers, each with its filing."],
                  ["neocloud_digest", "Neocloud companies with a filing in the last 7 days."],
                  ["themes_list", "Every theme (neocloud, physical AI, sector themes, weekly) and its upcoming events."],
                  ["theme_get", "One theme's members — next earnings, next event, Solana token, per-call URL."],
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
            Reads are free (committed data, no model call). The paid endpoints
            above settle on Solana;{" "}
            <code className="text-slate-500">signal_get</code> additionally has a
            demo twin on Base Sepolia (testnet funds) for exercising the 402 →
            sign → 200 loop without spending anything real.
          </p>
        </section>

        {/* Stocks: five rows here, the full list in the Stocks tab */}
        <section className="mt-16">
          <SolanaStocksSection preview={5} />
        </section>

        <footer className="mt-16 border-t border-slate-200 py-8 text-xs text-slate-400">
          <p>
            Informational only — not investment advice. Predictions are scored
            against public disclosure; no market-price / market-cap data is used.
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
