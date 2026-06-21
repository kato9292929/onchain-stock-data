import Link from "next/link";
import {
  getStocks,
  getIpos,
  getLiquidity,
  getHolders,
  getPickup,
  getPortfolioHistory,
  type PickupItem,
} from "@/lib/data";
import { Reveal } from "./components/reveal";

export const dynamic = "force-dynamic";

// ── formatting helpers (always round; never show raw values) ────────────
const fmtPrice = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";
const fmtTvl = (n: number) => {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n.toFixed(0);
};
const fmtCount = (n: number) => n.toLocaleString("en-US");

/** "@handle" derived from an x.com / twitter URL; falls back to the host. */
function handleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (seg && (/x\.com$/.test(u.hostname) || /twitter\.com$/.test(u.hostname))) {
      return "@" + seg;
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Coarse relative time ("1h", "3d") from an ISO timestamp. */
function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function pickupStatus(item: PickupItem): { text: string; cls: string } {
  // An explicit condition string wins; otherwise verifiable(green)/needs framing(gold).
  if (item.condition) return { text: item.condition, cls: "cond" };
  return item.catalyst_ready
    ? { text: "verifiable", cls: "ok" }
    : { text: "needs framing", cls: "cond" };
}

const NAV = [
  { href: "/alpha/portfolio", label: "Portfolio" },
  { href: "/stocks", label: "Stocks" },
  { href: "/ipo", label: "IPO" },
  { href: "/liquidity", label: "Liquidity" },
  { href: "/holders", label: "Holders" },
  { href: "/alpha", label: "Alpha" },
  { href: "/analyst", label: "Analyst" },
];

const PRICING = [
  { lab: "quick", amt: "$0.50", det: "5 internal endpoints. 3–5 min.", feat: false },
  { lab: "standard", amt: "$1.50", det: "+ recent SEC EDGAR filings. 10–15 min.", feat: true },
  { lab: "deep", amt: "$3.00", det: "+ earnings-call transcript + comparables. 20–30 min.", feat: false },
];

export default async function Home() {
  // Each source degrades independently; the page never fails on sample data.
  const [pickup, stocks, ipos, liquidity, holders, portfolioHistory] =
    await Promise.all([
      getPickup().catch(() => null),
      getStocks().catch(() => null),
      getIpos().catch(() => null),
      getLiquidity().catch(() => null),
      getHolders().catch(() => null),
      getPortfolioHistory().catch(() => null),
    ]);

  const portfolio = portfolioHistory?.current ?? null;
  const pickupItems = pickup?.items ?? [];
  const topStocks = (stocks?.stocks ?? []).slice(0, 4);
  const upcomingIpos = (ipos?.ipos ?? []).slice(0, 4);
  const topLiquidity = [...(liquidity?.pairs ?? [])]
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 3);
  const topHolders = [...(holders?.tokens ?? [])]
    .sort((a, b) => b.holder_count - a.holder_count)
    .slice(0, 3);

  return (
    <div className="osd-home">
      <Reveal />

      {/* nav */}
      <nav className="osd-nav">
        <div className="wrap nav-in">
          <a className="brand" href="/">
            <span className="dot" />
            Onchain Stock Data
          </a>
          <div className="nav-links">
            {NAV.map((n) => (
              <a key={n.label} href={n.href}>
                {n.label}
              </a>
            ))}
          </div>
          <a className="pill" href="#agents">
            for agents · x402
          </a>
        </div>
      </nav>

      {/* hero */}
      <header className="wrap hero rv in">
        <div className="eyebrow">onchain on solana · x402-native</div>
        <h1>
          Onchain stock data, <span className="gold">per call.</span>
        </h1>
        <p className="sub">
          xStocks, IPOs, liquidity and holder maps on Solana. Free HTML in the
          browser, x402 JSON for agents at $0.01 a call.
        </p>
      </header>

      {/* Portfolio — the main feature, surfaced at the top */}
      {portfolio ? (
        <section id="portfolio">
          <div className="wrap">
            <div className="sec-head rv">
              <div>
                <div className="eyebrow">claude portfolio</div>
                <h2>Portfolio</h2>
              </div>
              <p>
                毎週 Claude が選ぶ米株 10 銘柄。1 ヶ月の検証可能な catalyst を
                thesis に。SPY / NASDAQ との比較は portfolio ページを参照。
              </p>
            </div>
            <div className="pf rv">
              <div className="pf-meta">
                <span>
                  week of <span className="k">{portfolio.week_of}</span> ·{" "}
                  horizon <span className="k">{portfolio.horizon}</span> · model{" "}
                  <span className="k">{portfolio.model}</span>
                </span>
                <Link href="/alpha/portfolio">View full portfolio →</Link>
              </div>
              {portfolio.rationale ? (
                <div className="pf-rationale">{portfolio.rationale}</div>
              ) : null}
              <table className="pf-tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th className="hide-sm">Company</th>
                    <th className="r">Weight</th>
                    <th className="hide-sm">Thesis</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.holdings.map((h) => (
                    <tr key={h.ticker}>
                      <td className="tk">{h.ticker}</td>
                      <td className="co hide-sm">{h.company_name}</td>
                      <td className="w r">{h.weight.toFixed(1)}%</td>
                      <td className="th hide-sm">{h.thesis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* Pickup */}
      <section id="pickup">
        <div className="wrap">
          <div className="sec-head rv">
            <div>
              <div className="eyebrow">latest pickup</div>
              <h2>Pickup</h2>
            </div>
            <p>
              Curated market observations, summarized. Items with a date and a
              condition get tracked as verifiable calls.
            </p>
          </div>
          <div className="pick-grid">
            {pickupItems.map((item) => {
              const status = pickupStatus(item);
              const rel = relTime(item.posted_at);
              return (
                <article className="pick rv" key={item.theme}>
                  <span className="tag">{item.theme}</span>
                  <div className="body">{item.summary}</div>
                  <div className="meta">
                    <span className="src">
                      <b>{handleFromUrl(item.source_url)}</b>
                      {rel ? ` · ${rel}` : ""}
                    </span>
                    <span className={`status ${status.cls}`}>{status.text}</span>
                  </div>
                  <a
                    className="pick-link"
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on X →
                  </a>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Overview */}
      <section>
        <div className="wrap">
          <div className="sec-head rv">
            <div>
              <div className="eyebrow">at a glance</div>
              <h2>Overview</h2>
            </div>
            <p>The latest few rows from each layer. Open any section for the full set.</p>
          </div>
          <div className="ov-grid">
            {/* Stocks */}
            <div className="panel rv">
              <div className="panel-head">
                <span className="pt">Stocks</span>
                <Link href="/stocks">View all →</Link>
              </div>
              {topStocks.map((s) => {
                const tv = s.tokenized_versions[0];
                const chg = s.price_change_24h_pct ?? 0;
                return (
                  <div className="prow" key={s.underlying_ticker}>
                    <span className="nm">
                      <span className="lbl">{s.company_name}</span>
                      {tv ? <span className="sym">{tv.token_symbol}</span> : null}
                    </span>
                    <span className="vals">
                      <span className="px">{fmtPrice(s.price_usd)}</span>
                      <span className={chg >= 0 ? "up" : "down"}>{fmtPct(chg)}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* IPOs */}
            <div className="panel rv">
              <div className="panel-head">
                <span className="pt">IPOs</span>
                <Link href="/ipo">View all →</Link>
              </div>
              {upcomingIpos.map((i) => {
                const status = i.primary_issuance_platforms?.[0]?.status ?? "upcoming";
                const short = i.company_name.replace(/\s*[([].*$/, "").trim();
                return (
                  <div className="prow" key={i.ticker}>
                    <span className="nm">
                      <span className="lbl">{short}</span>
                      <span className="sym">{i.ticker}</span>
                    </span>
                    <span className="meta-s">{status}</span>
                  </div>
                );
              })}
            </div>

            {/* Liquidity */}
            <div className="panel rv">
              <div className="panel-head">
                <span className="pt">Liquidity</span>
                <Link href="/liquidity">View all →</Link>
              </div>
              {topLiquidity.map((p) => {
                const venue = p.top_pools?.[0]?.venue ?? "DEX";
                return (
                  <div className="prow" key={p.token_symbol}>
                    <span className="nm">
                      <span className="lbl">{p.token_symbol} / USDC</span>
                      <span className="sym">{venue}</span>
                    </span>
                    <span className="vals">
                      <span className="px">TVL {fmtTvl(p.tvl_usd)}</span>
                      <span className="meta-s">
                        dev {Math.abs(p.deviation_pct).toFixed(2)}%
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Holders */}
            <div className="panel rv">
              <div className="panel-head">
                <span className="pt">Holders</span>
                <Link href="/holders">View all →</Link>
              </div>
              {topHolders.map((h) => (
                <div className="prow" key={h.token_symbol}>
                  <span className="nm">
                    <span className="lbl">{h.token_symbol}</span>
                  </span>
                  <span className="vals">
                    <span className="px">{fmtCount(h.holder_count)} holders</span>
                    <span className="meta-s">conc. {h.concentration_score.toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* duality band */}
      <section id="agents">
        <div className="wrap rv">
          <div className="band">
            <div className="band-top">
              <div className="eyebrow">one url, two faces</div>
              <h2>Human or agent — same URL</h2>
              <p>
                User-Agent decides. Humans get the page; agents get HTTP 402 and
                pay over x402 before the JSON returns.
              </p>
            </div>
            <div className="duo">
              <div className="pane">
                <div className="who">
                  <span className="ic">browser</span>
                </div>
                <div className="ret">
                  <b>GET /api/stocks</b> → free HTML page
                </div>
                <div className="code">{`200 OK
{
  "source": "live",
  "stocks": [{ "ticker": `}<span className="g">{`"NVDA"`}</span>{` }]
}`}</div>
              </div>
              <div className="pane">
                <div className="who">
                  <span className="ic">agent</span> · curl / claude / gpt
                </div>
                <div className="ret">
                  <b>GET /api/stocks</b> → 402, then JSON on payment
                </div>
                <div className="code">{`402 Payment Required
{
  `}<span className="k">{`"scheme"`}</span>{`: "exact",
  `}<span className="k">{`"network"`}</span>{`: "base",
  "maxAmountRequiredUsd": `}<span className="g">{`"0.01"`}</span>{`
}`}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* analyst pricing */}
      <section>
        <div className="wrap">
          <div className="sec-head rv">
            <div>
              <div className="eyebrow">paid analyst</div>
              <h2>IC memos for agents</h2>
            </div>
            <p>
              Hits five internal endpoints in parallel and returns a
              Claude-structured IC memo. Settled in Base or Solana USDC.
            </p>
          </div>
          <div className="price-grid">
            {PRICING.map((p) => (
              <div className={`price rv${p.feat ? " feat" : ""}`} key={p.lab}>
                {p.feat ? <span className="feat-tag">standard</span> : null}
                <div className="lab">{p.lab}</div>
                <div className="amt">{p.amt}</div>
                <div className="det">{p.det}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="osd-foot">
        <div className="wrap foot-in">
          <div>
            <div className="brand" style={{ marginBottom: 14 }}>
              <span className="dot" />
              onchain stock data
            </div>
            <p className="disclaimer">
              Not investment advice. Values are indicative — confirm the latest on
              each exchange or chain before trading. xStocks and Backpack IPOs
              Onchain carry regional and KYC restrictions.
            </p>
            <div className="copy">© 2026 x402 Inc.</div>
          </div>
          <div className="foot-links">
            <Link href="/alpha/portfolio">Portfolio</Link>
            <Link href="/stocks">Stocks</Link>
            <Link href="/analyst">Analyst</Link>
            <a href="#agents">x402</a>
            <a
              href="https://github.com/kato9292929/onchain-stock-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
