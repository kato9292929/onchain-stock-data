---
name: onchain-trending
description: Show which tokenized stocks are trading most on Solana right now (xStocks, Ondo, Backpack Securities — and the stocks listed via Sunrise) — 24h volume, trades, holders, holder growth, new listings and each issuer's share — and brief the notable ones from their filings. Use when the user asks what is hot or trending in tokenized stocks, about a new onchain listing (e.g. an IPO token), or which issuer leads.
argument-hint: "[new]"
---

# Trading now on Solana (OSD)

1. Call the OSD MCP tool `onchain_trending` (`limit: 20`). If `$ARGUMENTS` contains "new", pass `new_only: true`.
2. Present the result:
   - Total 24h volume and each issuer's share (`by_issuer`).
   - A table of the top stocks: rank, ticker, name, 24h volume, trades, holders (with `holder_change_24h_pct` when it is ±1% or more), main issuer, and a **New** mark when `new_listing_since` is set.
3. For each new listing and for anything whose holders grew 10%+ in 24h, call `stock_brief` and add two lines: what the company last filed (form, date, link) and whether it has reported a quarter yet.
4. Say clearly: this covers the tokenized stocks among Solana's top 100 tokens by 24h volume (Jupiter's public token API, refreshed every 15 minutes). It is market activity — not a signal and not used to judge any condition. A stock outside the top 100 is not shown; use `stock_brief` for it.

Do not add price commentary or predictions. End with "Data: Jupiter token API and SEC EDGAR via Onchain Stock Data. Not investment advice."
