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
 *   - FREE, unsigned MCP reads (all 5 tools here): portfolio_get, catalysts_list,
 *     scoreboard_get, signal_get, solana_stock_get, themes_list, theme_get. Every tool is read-only (annotations:
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
    serverInfo: { name: "onchain-stock-data", version: "0.1.0" },
  },
);

export { handler as GET, handler as POST, handler as DELETE };
