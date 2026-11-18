import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getPortfolioHistory,
  getJpPortfolioHistory,
} from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getSignals } from "@/lib/signals";
import { buildScoreboard, ARTICLE_TITLES } from "@/lib/physical-ai-scoreboard";
import { PUBLIC_BASE_URL, BASE_SEPOLIA_NETWORK } from "@/lib/x402";
import { freeBody } from "@/lib/solana-stocks";
import { externalRow, getEarningsDates, nextEarningsOf } from "@/lib/company-record";
import { loadRecords } from "@/lib/solana-stocks-load";
import { getSolanaStocks } from "@/lib/solana-stocks";
import { findTheme, getThemes, themeFreeBody, themesIndexBody } from "@/lib/themes";
import { loadSolanaStocks } from "@/lib/solana-stocks-load";
import { companyFreeBody, digestFreeBody, findNeocloudCompany } from "@/lib/neocloud";
import { getStockBrief } from "@/lib/stock-brief";
import { filingIndexUrl, getSecRecord } from "@/lib/edgar";
import { selectionRows } from "@/lib/selection";
import { hitRateOf, tally } from "@/lib/hit-rate";
import { getLargeHoldings, LARGE_HOLDING_WINDOW_DAYS } from "@/lib/edinet";

/**
 * Remote MCP server for Onchain Stock Data.
 *
 * Exposes osd's already-published research as MCP tools so ChatGPT / Claude can
 * read it in plain language ("話しかけるだけ"). Every tool here is read-only and
 * serves data already committed to git — NO Anthropic model call happens on a
 * tool invocation, so this endpoint costs nothing to run.
 *
 * `signal_get` is the resource that has a paid twin: the same signals are
 * gated behind an x402 testnet endpoint for the "agent pays" demo. This MCP
 * tool returns the committed signal data (free read) and points at that paid
 * resource; the actual 402 → pay → retry is exercised by an x402-capable
 * client (AA) against the HTTP endpoint, not by a vanilla MCP client.
 *
 * Mounted as a single web-standard handler (mcp-handler v2) at /api/mcp.
 *
 * FREE / PAID line (kept in sync with the README):
 *   - FREE, unsigned MCP reads (every tool here): neocloud_theme, neocloud_company,
 *     neocloud_digest, portfolio_get, catalysts_list, scoreboard_get, signal_get,
 *     solana_stock_get, themes_list, theme_get. Every tool is read-only (annotations:
 *     readOnlyHint:true, destructiveHint:false) and serves committed git data —
 *     no model call, so a tool invocation costs nothing to run.
 *   - PAID access lives on the HTTP per-call endpoints, NOT on this MCP surface:
 *       · /api/catalyst/:ticker and /api/edinet/:code — x402 402-gated, settled
 *         per call in USDC on Solana mainnet at PER_CALL_PRICE (0.001 USDC).
 *       · /api/testnet/signal — the paid twin of signal_get (Base Sepolia
 *         testnet demo), priced separately (X402_TESTNET_SIGNAL_PRICE).
 *   - NO subscription / metered account billing exists anywhere (out of scope).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wrap a JSON-serializable value as an MCP text content result. */
function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const handler = createMcpHandler(
  (server) => {
    // ── read-only: neocloud (free views; the paid twins are HTTP per-call) ─
    const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    // Tools that read SEC EDGAR / EDINET live (public, free, rate-limited in lib/edgar.ts).
    const LIVE = { ...RO, openWorldHint: true };
    const today = () => new Date().toISOString().slice(0, 10);

    // ── stocks: the company's own filings, every number with its document ──
    server.registerTool(
      "stock_brief",
      {
        title: "Stock brief before earnings",
        description:
          "One US stock, as a trader checks it before a report: the last quarter as filed (revenue, operating income, net income, diluted EPS — each with year-over-year, the 10-Q / 10-K it came from and its URL), the next earnings date where a primary source states it, the latest SEC filings, the conditions this site has open on it, and its track record (verdicts with evidence URLs). Sources: SEC EDGAR XBRL and OSD's committed records. No model, no estimates.",
        inputSchema: z.object({ ticker: z.string().describe("US ticker, e.g. NVDA, AAPL, BRK.B") }),
        annotations: { title: "Stock brief before earnings", ...LIVE },
      },
      async ({ ticker }) => {
        const rec = await loadRecords();
        try {
          return text(await getStockBrief(ticker, rec, today()));
        } catch (e) {
          return text({ error: "sec_unavailable", message: e instanceof Error ? e.message : String(e) });
        }
      },
    );
    server.registerTool(
      "stock_financials",
      {
        title: "Financials as filed (SEC XBRL)",
        description:
          "A US company's revenue, operating income, net income, diluted EPS, cash and shares outstanding over time, exactly as tagged in its 10-Q / 10-K (newest first). Each value carries the form, filed date and the filing URL. A metric the company does not tag is absent, never estimated.",
        inputSchema: z.object({
          ticker: z.string().describe("US ticker, e.g. NVDA"),
          metric: z
            .enum(["revenue", "operating_income", "net_income", "eps_diluted", "cash", "shares_outstanding"])
            .optional()
            .describe("one metric; all when omitted"),
          period: z.enum(["quarterly", "annual"]).default("quarterly"),
          limit: z.number().int().min(1).max(8).default(8),
        }),
        annotations: { title: "Financials as filed (SEC XBRL)", ...LIVE },
      },
      async ({ ticker, metric, period, limit }) => {
        let sec;
        try {
          sec = await getSecRecord(ticker);
        } catch (e) {
          return text({ error: "sec_unavailable", message: e instanceof Error ? e.message : String(e) });
        }
        if (!sec) return text({ error: "not an SEC filer", ticker: ticker.toUpperCase() });
        const keys = metric ? [metric] : Object.keys(sec.financials);
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          const s = sec.financials[k];
          if (!s) continue;
          const series = s.instant.length && !s.quarterly.length && !s.annual.length ? s.instant : period === "annual" ? s.annual : s.quarterly;
          out[k] = {
            tag: s.tag,
            unit: s.unit,
            values: series.slice(0, limit).map((v) => ({ ...v, document: filingIndexUrl(sec.cik, v.accession) })),
          };
        }
        return text({ ticker: ticker.toUpperCase(), company: sec.company, cik: sec.cik, source: sec.source, period, financials: out });
      },
    );
    server.registerTool(
      "stock_filings",
      {
        title: "Latest SEC filings",
        description: "A US company's latest SEC filings (10-K, 10-Q, 8-K, proxy, ownership…), newest first, each with its document URL. Filter by form.",
        inputSchema: z.object({
          ticker: z.string().describe("US ticker, e.g. NVDA"),
          forms: z.array(z.string()).optional().describe('e.g. ["8-K"] or ["10-Q","10-K"]'),
          limit: z.number().int().min(1).max(20).default(10),
        }),
        annotations: { title: "Latest SEC filings", ...LIVE },
      },
      async ({ ticker, forms, limit }) => {
        let sec;
        try {
          sec = await getSecRecord(ticker);
        } catch (e) {
          return text({ error: "sec_unavailable", message: e instanceof Error ? e.message : String(e) });
        }
        if (!sec) return text({ error: "not an SEC filer", ticker: ticker.toUpperCase() });
        const want = forms?.map((f) => f.toUpperCase());
        const filings = sec.filings.filter((f) => !want || want.includes(f.form.toUpperCase())).slice(0, limit);
        return text({ ticker: ticker.toUpperCase(), company: sec.company, cik: sec.cik, filings });
      },
    );

    // ── Selection: the conditions and how each was judged ──────────────────
    server.registerTool(
      "selection_list",
      {
        title: "Selection: conditions and verdicts",
        description:
          "OSD's dated, numeric conditions on US and Japanese stocks and how each was judged against the company's own filing (HIT / PARTIAL / MISS / N/A, with the evidence URL). One stock × one earnings counts once. Filter by category, status or ticker; the hit rate is computed over what is returned (partial = 0.5; N/A stays in the denominator).",
        inputSchema: z.object({
          category: z.enum(["all", "weekly", "us-stocks", "neocloud", "physical-ai", "jp-sectors"]).default("all"),
          status: z.enum(["all", "judged", "pending"]).default("all"),
          ticker: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
        annotations: { title: "Selection: conditions and verdicts", ...RO },
      },
      async ({ category, status, ticker, limit }) => {
        const rec = await loadRecords();
        const tk = ticker?.toUpperCase();
        const rows = selectionRows(rec, today()).filter(
          (r) =>
            (category === "all" || r.group === category) &&
            (status === "all" || (status === "judged" ? r.status === "judged" : r.status !== "judged")) &&
            (!tk || r.ticker === tk),
        );
        const counts = tally(rows.filter((r) => r.status === "judged").map((r) => r.result));
        return text({
          count: rows.length,
          counts: { hit: counts.hit, partial: counts.partial, miss: counts.miss, na: counts.na },
          hit_rate: hitRateOf(counts),
          rows: rows.slice(0, limit).map(({ population, ...r }) => ({ ...r, source: population })),
        });
      },
    );
    server.registerTool(
      "earnings_upcoming",
      {
        title: "Conditions due in the next N days",
        description: "The open conditions whose deadline (usually the earnings date) falls in the next N days, nearest first — what is about to be judged.",
        inputSchema: z.object({ days: z.number().int().min(1).max(90).default(14) }),
        annotations: { title: "Conditions due in the next N days", ...RO },
      },
      async ({ days }) => {
        const rec = await loadRecords();
        const from = today();
        const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        const rows = selectionRows(rec, from)
          .filter((r) => r.status === "active" && r.target_date >= from && r.target_date <= to)
          .sort((a, b) => a.target_date.localeCompare(b.target_date));
        return text({ from, to, count: rows.length, rows: rows.map(({ population, ...r }) => ({ ...r, source: population })) });
      },
    );

    // ── Japan: large-holding reports (EDINET) ─────────────────────────────
    server.registerTool(
      "large_holdings",
      {
        title: "Japan large-holding reports (EDINET)",
        description:
          "Every 大量保有報告書 (initial, 5% crossed) and 変更報告書 (change) filed on a Japanese company's shares in the window, newest first: holder, report type, submission time and document id (出典：金融庁 EDINET). Holding ratios are not served yet.",
        inputSchema: z.object({
          code: z.string().describe("TSE code, e.g. 6871 or 285A"),
          days: z.number().int().min(1).max(400).default(LARGE_HOLDING_WINDOW_DAYS),
        }),
        annotations: { title: "Japan large-holding reports (EDINET)", ...LIVE },
      },
      async ({ code, days }) => {
        try {
          const lh = await getLargeHoldings(code.toUpperCase(), days);
          return text({ source: "出典：金融庁 EDINET", code: code.toUpperCase(), window_days: days, ...lh });
        } catch (e) {
          return text({ error: "edinet_unavailable", message: e instanceof Error ? e.message : String(e) });
        }
      },
    );

    server.registerTool(
      "neocloud_theme",
      {
        title: "Get the neocloud theme (US / JP)",
        description:
          "Free view of the neocloud theme: US 18 or JP 5 companies with next earnings (primary source only), each company's latest contracted and energized MW with the document URL, and the theme total. The full theme (conditions, verdicts and every number over time) is the per-call URL in `full` (0.01 USDC, x402 on Solana).",
        inputSchema: z.object({ market: z.enum(["us", "jp"]).default("us") }),
        annotations: { title: "Get the neocloud theme (US / JP)", ...RO },
      },
      async ({ market }) => {
        const [themes, rec, solana] = await Promise.all([getThemes(), loadRecords(), getSolanaStocks().catch(() => null)]);
        const t = findTheme(themes, market === "jp" ? "neocloud-jp" : "neocloud-us");
        if (!t) return text({ error: "theme not found" });
        return text(themeFreeBody(t, rec, solana, new Date().toISOString().slice(0, 10), PUBLIC_BASE_URL));
      },
    );
    server.registerTool(
      "neocloud_company",
      {
        title: "Get one neocloud company's latest numbers",
        description:
          "Free view of one neocloud company (e.g. CRWV, NBIS, IREN, 3778): the latest disclosed number per item — contracted and energized MW, backlog / RPO, revenue and capex guidance, financing, key contracts — each with its filing URL and date; null where nothing is disclosed. The series over time, conditions and verdicts are the per-call URL in `full` (0.001 USDC, x402 on Solana).",
        inputSchema: z.object({ ticker: z.string().describe("Ticker or code, e.g. CRWV, 3778, LAMBDA") }),
        annotations: { title: "Get one neocloud company's latest numbers", ...RO },
      },
      async ({ ticker }) => {
        const rec = await loadRecords();
        const company = findNeocloudCompany(rec.themes, ticker);
        if (!company) return text({ error: "not a neocloud company", ticker: ticker.toUpperCase() });
        return text(
          companyFreeBody(
            { company, rec, metrics: rec.neocloud, filings: rec.neocloudFilings, today: new Date().toISOString().slice(0, 10) },
            PUBLIC_BASE_URL,
          ),
        );
      },
    );
    server.registerTool(
      "neocloud_digest",
      {
        title: "Neocloud disclosures of the last 7 days",
        description:
          "Free list of the neocloud companies with a filing (SEC EDGAR / TDnet) or a newly recorded number in the last 7 days. The filings, summaries and how each number moved are the per-call URL in `full` (0.001 USDC, x402 on Solana).",
        inputSchema: z.object({}),
        annotations: { title: "Neocloud disclosures of the last 7 days", ...RO },
      },
      async () => {
        const rec = await loadRecords();
        return text(
          digestFreeBody(
            {
              themes: rec.themes,
              metrics: rec.neocloud,
              filings: rec.neocloudFilings,
              signals: rec.signals,
              today: new Date().toISOString().slice(0, 10),
            },
            PUBLIC_BASE_URL,
          ),
        );
      },
    );

    // ── read-only: US / JP portfolio ────────────────────────────────────
    server.registerTool(
      "portfolio_get",
      {
        title: "Get weekly portfolio (US/JP)",
        description:
          "Current Claude-selected equity portfolio (weights, thesis, catalyst target dates) for the US or JP book.",
        inputSchema: z.object({ market: z.enum(["us", "jp"]).default("us") }),
        // FREE, read-only. Serves committed research; no external calls, no writes.
        annotations: {
          title: "Get weekly portfolio (US/JP)",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ market }) => {
        const file =
          market === "jp"
            ? await getJpPortfolioHistory().catch(() => null)
            : await getPortfolioHistory().catch(() => null);
        const earnings = await getEarningsDates();
        const today = new Date().toISOString().slice(0, 10);
        const cur = file?.current ?? null;
        if (!cur) return text({ market, error: "no current portfolio" });
        return text({
          market,
          week_of: cur.week_of,
          generated_at: cur.generated_at,
          model: cur.model,
          horizon: cur.horizon,
          rationale: cur.rationale,
          holdings: cur.holdings.map((h) => ({
            ticker: h.ticker,
            company_name: h.company_name,
            weight: h.weight,
            thesis: h.thesis,
            target_date: h.target_date ?? null,
            next_earnings: nextEarningsOf(h.ticker, { earnings }, today),
          })),
        });
      },
    );

    // ── read-only: dated catalysts ──────────────────────────────────────
    server.registerTool(
      "catalysts_list",
      {
        title: "List dated catalysts",
        description:
          "Dated numeric catalysts sorted by target_date (ascending). Filter by date range, ticker, or theme (series).",
        annotations: {
          title: "List dated catalysts",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        inputSchema: z.object({
          from: z
            .string()
            .optional()
            .describe("YYYY-MM-DD lower bound on target_date"),
          to: z
            .string()
            .optional()
            .describe("YYYY-MM-DD upper bound on target_date"),
          ticker: z.string().optional(),
          theme: z.string().optional().describe("series label, e.g. physical-ai"),
          limit: z.number().int().min(1).max(100).default(20),
        }),
      },
      async ({ from, to, ticker, theme, limit }) => {
        const all = await readExternalCatalysts().catch(() => []);
        const tk = ticker?.toUpperCase();
        const rows = all
          .filter((c) => (tk ? c.ticker?.toUpperCase() === tk : true))
          .filter((c) => (theme ? c.series === theme : true))
          .filter((c) => (from ? c.target_date >= from : true))
          .filter((c) => (to ? c.target_date <= to : true))
          .sort((a, b) => (a.target_date < b.target_date ? -1 : 1))
          .slice(0, limit)
          .map((c) => {
            const r = externalRow(c);
            return {
              id: r.id,
              ticker: r.ticker,
              company: r.company,
              market: c.market ?? "US",
              question: r.question,
              target_date: r.target_date,
              result: r.result,
              judged_at: r.judged_at,
              evidence_url: r.evidence_url,
              series: c.series ?? null,
              series_article: c.series_article ?? null,
            };
          });
        return text({ count: rows.length, catalysts: rows });
      },
    );

    // ── read-only: free scoreboard (auto-graded predictions) ────────────
    server.registerTool(
      "scoreboard_get",
      {
        title: "Get Physical-AI scoreboard",
        description:
          "Free scoreboard: hit/partial/miss tally of the Physical-AI dated catalysts, overall and per article.",
        inputSchema: z.object({}),
        annotations: {
          title: "Get Physical-AI scoreboard",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const all = await readExternalCatalysts().catch(() => []);
        const asOf = new Date().toISOString().slice(0, 10);
        const board = buildScoreboard(all, asOf);
        return text({
          as_of: asOf,
          overall: board.overall,
          articles: board.articles.map((a) => ({
            article: a.article,
            title: ARTICLE_TITLES[a.article] ?? a.title,
            hit_rate: a.hit_rate,
            judged: a.judged,
            total: a.total,
          })),
        });
      },
    );

    // ── read-only: themes (free views) ──────────────────────────────────
    server.registerTool(
      "themes_list",
      {
        title: "List themes",
        description:
          "Every theme this site tracks (neocloud US/JP, physical AI US/JP, weekly selections, sector themes): id, member count, members with an event in the next 14 days. Field reference: /docs.",
        inputSchema: z.object({}),
        annotations: { title: "List themes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => {
        const [themes, rec] = await Promise.all([getThemes(), loadRecords()]);
        if (!themes) return text({ error: "themes unavailable" });
        return text(themesIndexBody(themes, rec, new Date().toISOString().slice(0, 10)));
      },
    );
    server.registerTool(
      "theme_get",
      {
        title: "Get a theme",
        description:
          "Free view of one theme: members with ticker, company, next earnings (primary source only), next event date and whether a Solana token exists, plus the per-call URL of the full theme (0.01 USDC, x402 on Solana).",
        inputSchema: z.object({ theme: z.string().describe("Theme id, e.g. neocloud-us") }),
        annotations: { title: "Get a theme", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ theme }) => {
        const [themes, rec, solana] = await Promise.all([getThemes(), loadRecords(), getSolanaStocks().catch(() => null)]);
        const t = findTheme(themes, theme);
        if (!t) return text({ error: "theme not found", theme });
        return text(themeFreeBody(t, rec, solana, new Date().toISOString().slice(0, 10), PUBLIC_BASE_URL));
      },
    );

    // ── read-only: tokenized stocks on Solana (free view) ───────────────
    server.registerTool(
      "solana_stock_get",
      {
        title: "Get a tokenized stock on Solana",
        description:
          "Free view of one tokenized stock on Solana (xStocks / Ondo Global Markets): tokens and mints, the next earnings date (primary source only; status confirmed / not_announced / unverified), condition counts, the latest verdict, and the per-call URL of the full record (x402, USDC on Solana). Field reference: /docs.",
        annotations: {
          title: "Get a tokenized stock on Solana",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        inputSchema: z.object({
          ticker: z.string().describe("Underlying ticker, e.g. NVDA"),
        }),
      },
      async ({ ticker }) => {
        const { file, rec, today } = await loadSolanaStocks();
        const body = freeBody(ticker, file, rec, today, PUBLIC_BASE_URL);
        return text(body ?? { error: "ticker not found", ticker: ticker.toUpperCase() });
      },
    );

    // ── paid twin: pre-generated signals (free read here) ───────────────
    server.registerTool(
      "signal_get",
      {
        title: "Get directional signals (x402 paid twin)",
        description:
          "Pre-generated directional signals for a ticker or theme. This is the resource with a paid x402 testnet twin (see `payment`); the values here are read-only committed data.",
        // Read here is FREE; the paid gate is the HTTP twin /api/testnet/signal.
        annotations: {
          title: "Get directional signals (x402 paid twin)",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        inputSchema: z.object({
          ticker: z.string().optional(),
          theme: z
            .string()
            .optional()
            .describe("scope label, e.g. AI-infra, JP-rates"),
        }),
      },
      async ({ ticker, theme }) => {
        const file = await getSignals().catch(() => null);
        const tk = ticker?.toUpperCase();
        const matched = (file?.signals ?? []).filter((s) => {
          if (tk)
            return (
              s.scope?.toUpperCase() === tk ||
              (s.tickers ?? []).some((t) => t.toUpperCase() === tk)
            );
          if (theme) return s.scope === theme;
          return true;
        });
        return text({
          count: matched.length,
          signals: matched.map((s) => ({
            id: s.id,
            claim: s.claim,
            basis: s.basis,
            direction: s.direction,
            scope: s.scope,
            tickers: s.tickers,
            observable: s.observable,
            threshold: s.threshold,
            target_date: s.target_date,
            source_tier: s.source_tier,
            verified: s.verified,
            status: s.status,
          })),
          payment: {
            network: BASE_SEPOLIA_NETWORK,
            resource: `${PUBLIC_BASE_URL}/api/testnet/signal`,
          },
        });
      },
    );
  },
  {
    serverInfo: { name: "onchain-stock-data", version: "0.2.0" },
  },
);

export { handler as GET, handler as POST, handler as DELETE };
