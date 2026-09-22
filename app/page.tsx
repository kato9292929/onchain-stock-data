import Link from "next/link";
import { getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { buildScoreboard, ARTICLE_TITLES } from "@/lib/physical-ai-scoreboard";
import { LandingHero } from "./components/landing-hero";
import { RailMarquee } from "./components/rail-marquee";
import { SolanaMark } from "./components/solana-mark";
import { PER_CALL_PRICE } from "@/lib/x402";

export const dynamic = "force-dynamic";

/**
 * Light, readable landing. Product axis: prediction track record (catalysts) +
 * this week's catalyst-derived selection. No P&L / benchmark tracking.
 */
export default async function Home() {
  const [portfolio, catalysts] = await Promise.all([
    getPortfolioHistory().catch(() => null),
    readExternalCatalysts().catch(() => []),
  ]);
  const asOf = new Date().toISOString().slice(0, 10);
  const board = buildScoreboard(catalysts, asOf);
  const o = board.overall;
  const cur = portfolio?.current ?? null;

  return (
    <div className="font-inter min-h-screen bg-[#f9fafb] text-slate-900">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <LandingHero />

        <div className="mt-10">
          <RailMarquee />
        </div>

        {/* Catalysts — the track record */}
        <section className="mt-16">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Track record
              </div>
              <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">Catalysts</h2>
            </div>
            <Link href="/catalysts" className="text-sm font-semibold text-[#0a152d] hover:underline">
              View all sectors →
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-outfit text-[#0a1b33]">Overall</span>
              <span className="text-xs text-slate-400">{o.total} conditions</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ["Hit rate", o.hit_rate == null ? "—" : `${(o.hit_rate * 100).toFixed(0)}%`, true],
                ["HIT", o.counts.hit, false],
                ["PARTIAL", o.counts.partial, false],
                ["MISS", o.counts.miss, false],
                ["N/A", o.counts.na, false],
                ["Pending", o.counts.pending, false],
              ].map(([label, value, accent]) => (
                <div key={label as string} className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center">
                  <div className={`text-lg font-semibold tabular-nums ${accent ? "text-[#0a1b33]" : "text-slate-700"}`}>
                    {value as string | number}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{label as string}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Physical AI 6 + sectors, as light chips */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.articles.map((a) => (
              <Link
                key={a.article}
                href={`/catalysts/physical-ai-${a.article}`}
                className="rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
              >
                <div className="text-[11px] text-slate-400">Article {a.article}</div>
                <div className="font-outfit text-sm font-semibold text-[#0a1b33]">
                  {ARTICLE_TITLES[a.article] ?? a.title}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Hit rate{" "}
                  <span className="font-semibold text-[#0a1b33]">
                    {a.hit_rate == null ? "—" : `${(a.hit_rate * 100).toFixed(0)}%`}
                  </span>{" "}
                  · {a.judged}/{a.total}
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* This week's selection — from catalysts, NOT a P&L */}
        {cur && (
          <section className="mt-16">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Week of {cur.week_of} · catalyst-derived
                </div>
                <h2 className="font-outfit text-2xl font-semibold text-[#0a1b33]">This week&apos;s selection</h2>
              </div>
              <Link href="/portfolio" className="text-sm font-semibold text-[#0a152d] hover:underline">
                See the picks →
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="mb-4 max-w-2xl text-sm text-slate-500">
                A research selection built from dated catalysts — not a fund and not a
                performance track. Each name carries a verifiable 1-month catalyst.
              </p>
              <div className="flex flex-wrap gap-2">
                {cur.holdings.map((h) => (
                  <span
                    key={h.ticker}
                    title={h.company_name}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px]"
                  >
                    <span className="font-semibold text-[#0a1b33]">{h.ticker}</span>
                    <span className="tabular-nums text-slate-400">{h.weight}%</span>
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

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
                  what: "Per-company lookups",
                  detail: "/api/catalyst/{ticker} · /api/edinet/{code}",
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
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Tools
              </div>
              <ul className="mt-3 space-y-3">
                {[
                  ["portfolio_get", "Current US / JP selection — weights, thesis, catalyst dates."],
                  ["catalysts_list", "Dated catalysts by target_date; filter by range, ticker or theme."],
                  ["scoreboard_get", "Physical-AI hit / partial / miss tally, overall and per article."],
                  ["signal_get", "Directional signals by ticker / theme (paid x402 testnet twin)."],
                ].map(([name, desc]) => (
                  <li key={name} className="flex flex-col gap-0.5">
                    <code className="font-mono text-[13px] font-semibold text-[#0a1b33]">{name}</code>
                    <span className="text-[13px] text-slate-500">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* connect */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
