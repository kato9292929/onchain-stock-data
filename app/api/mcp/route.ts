import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  getPortfolioHistory,
  getJpPortfolioHistory,
} from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getSignals } from "@/lib/signals";
import { buildScoreboard, ARTICLE_TITLES } from "@/lib/physical-ai-scoreboard";
import { PUBLIC_BASE_URL } from "@/lib/x402";

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
        description:
          "Current Claude-selected equity portfolio (weights, thesis, catalyst target dates) for the US or JP book.",
        inputSchema: z.object({ market: z.enum(["us", "jp"]).default("us") }),
      },
      async ({ market }) => {
        const file =
          market === "jp"
            ? await getJpPortfolioHistory().catch(() => null)
            : await getPortfolioHistory().catch(() => null);
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
            target_date: h.target_date,
          })),
        });
      },
    );

    // ── read-only: dated catalysts ──────────────────────────────────────
    server.registerTool(
      "catalysts_list",
      {
        description:
          "Dated numeric catalysts sorted by target_date (ascending). Filter by date range, ticker, or theme (series).",
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
          .map((c) => ({
            catalyst_id: c.catalyst_id,
            ticker: c.ticker,
            company_name: c.company_name,
            market: c.market ?? "US",
            catalyst: c.catalyst_description,
            target_date: c.target_date,
            status: c.status,
            series: c.series,
            series_article: c.series_article,
          }));
        return text({ count: rows.length, catalysts: rows });
      },
    );

    // ── read-only: free scoreboard (auto-graded predictions) ────────────
    server.registerTool(
      "scoreboard_get",
      {
        description:
          "Free scoreboard: hit/partial/miss tally of the Physical-AI dated catalysts, overall and per article.",
        inputSchema: z.object({}),
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

    // ── paid twin: pre-generated signals (free read here) ───────────────
    server.registerTool(
      "signal_get",
      {
        description:
          "Pre-generated directional signals for a ticker or theme. This is the resource with a paid x402 testnet twin (see `payment`); the values here are read-only committed data.",
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
            note: "Paid access to this resource is settled per-call via x402 on Base Sepolia (testnet). A vanilla MCP client reads for free here; an x402-capable agent pays at the HTTP endpoint.",
            network: "eip155:84532",
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
