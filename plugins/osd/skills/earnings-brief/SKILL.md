---
name: earnings-brief
description: Brief one US stock before its earnings report from the company's own SEC filings — last quarter as filed with year-over-year, next earnings date, latest filings, open conditions and track record, plus onchain activity of its Solana tokens. Use when the user asks about a stock ahead of earnings, "what to watch" for a ticker, or wants numbers with sources rather than estimates.
argument-hint: "[ticker]"
---

# Earnings brief (OSD)

Build a short, sourced brief for the ticker in `$ARGUMENTS` (ask for one if it is empty). Every number must come from a tool result and carry its document link. Never estimate, never quote a price target, never use market prices as evidence.

## Steps

1. Call the OSD MCP tool `stock_brief` with the ticker. It returns:
   - `last_quarter`: revenue, operating income, net income, diluted EPS — each with `yoy`, `form`, `filed` and `document` (the filing). A fiscal Q4 is derived as full year less Q1–Q3 and says so in `how`.
   - `next_earnings` (only when a primary source states it), `recent_filings`, `conditions_open`, `track_record`, and `onchain` (volume and holders of its tokens on Solana).
2. If the user wants a longer view, call `stock_financials` (quarterly or annual, up to 8 periods).
3. If an 8-K was filed in the last few days, call `stock_filings` with `forms: ["8-K"]` and say it may be the earnings release.
4. Call `earnings_upcoming` with `days: 14` only if the user asks what else reports soon.

## Output

- **Last quarter** — a small table: metric, value, YoY, period end, filing link. Use USD bn / mn and per-share for EPS.
- **What is open** — the conditions in `conditions_open` with their deadline; say plainly that they are judged on the filing, HIT / PARTIAL / MISS.
- **Track record** — judged count, hit rate and the latest verdicts with evidence links. Say if there are none.
- **Onchain** — per issuer token: 24h volume and holders. Label it market activity, not evidence.
- **Recent filings** — the 3–5 most relevant, linked.

If the company is not an SEC filer (`note` in the result), say so and show only what exists. If a tool returns an error, report it; do not fill the gap from memory. End with: "Data: SEC EDGAR via Onchain Stock Data (osd-coral.vercel.app). Not investment advice."
