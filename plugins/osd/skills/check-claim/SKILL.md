---
name: check-claim
description: Turn a market claim from a post, article or chat (e.g. "SoftBank's LTV is already above 25%", "Nvidia's data center growth is slowing") into a dated, numeric condition that the company's own next disclosure will settle, and show what the filings say today. Use when the user pastes or describes a claim about a company's numbers and asks whether it is true, or wants to track it.
argument-hint: "[the claim, or paste it]"
---

# Check a claim against the filings (OSD)

The claim is in `$ARGUMENTS` (or the user's message). OSD's rule: a claim is only checkable if it names **a number, a threshold and a date**, and the company itself will disclose that number. Market prices are never the evidence.

## Steps

1. Restate the claim as one condition: *company · metric · operator · threshold · the report that will disclose it (and its expected date)*. If the claim has no number or the company does not disclose that metric, say so and propose the nearest disclosed metric instead (e.g. for "LTV": the LTV the company publishes in its quarterly results).
2. Find what is on record:
   - US companies: `stock_brief`, then `stock_financials` for the metric over time, and `stock_filings` for the latest 10-Q / 10-K / 8-K.
   - Japanese companies: `large_holdings` for ownership changes; for other numbers, say they come from the company's TDnet results and give the expected date.
   - `selection_list` with the ticker: is there already a condition on it, and how were past ones judged?
3. Answer in three parts:
   - **The condition** — written exactly, with the deadline.
   - **What the filings say now** — the latest disclosed values, each with its link and period. Separate the company's own figures from the claim's estimate.
   - **How it will be settled** — which document, when, and what would make it HIT or MISS.

Never call the claim true or false before the company's own number is out; call it "estimate" until then. End with "Data: SEC EDGAR / EDINET via Onchain Stock Data. Not investment advice."
