# osd MCP — verification (Inspector procedure + sample I/O)

The remote MCP server `onchain-stock-data` is mounted at **`/api/mcp`**
(`app/api/mcp/route.ts`, `mcp-handler` v2, Streamable HTTP transport). It
exposes four **read-only, free** tools over already-committed research.

## Free / paid line

| surface | tools / endpoints | access |
|---|---|---|
| **MCP (`/api/mcp`)** | `portfolio_get`, `catalysts_list`, `scoreboard_get`, `signal_get` | **FREE**, unsigned. Every tool is read-only (`readOnlyHint:true`, `destructiveHint:false`); no model call runs on a tool invocation. |
| **HTTP per-call (x402)** | `/api/catalyst/{ticker}`, `/api/edinet/{code}` | **PAID** — 402-gated, settled per call in **USDC on Solana** at `PER_CALL_PRICE` (**0.001 USDC** = 1000 base units, `exact`). `/api/edinet/{code}` currently supplies disclosure metadata + accounting period only (`financials_available:false`). |
| **HTTP per-call (testnet demo)** | `/api/testnet/signal` — the paid twin of `signal_get` | **PAID (testnet)** — Base Sepolia USDC, priced separately (`X402_TESTNET_SIGNAL_PRICE`, default `$0.05`). |

No subscription / metered-account billing exists anywhere — **out of scope by
design**. The per-call price is defined once in `lib/x402.ts` (`PER_CALL_PRICE`)
and referenced by the routes + descriptors; it is never re-literalled.

## Headless verification (this repo)

```bash
# 1) start the app locally
npm run dev            # or: npm run build && npm start

# 2) run the headless inspector against it
MCP_URL=http://localhost:3000/api/mcp npm run mcp:inspect
# → against production:
MCP_URL=https://osd.x402jp.com/api/mcp npm run mcp:inspect
```

`scripts/mcp-inspect.mjs` runs `initialize → notifications/initialized →
tools/list → tools/call (×4)` and **fails loud** (non-zero exit) if the
handshake errors, a tool is missing, a tool lacks its `title` /
`readOnlyHint:true` / `destructiveHint:false` annotation, a tool name exceeds 64
chars, or any `tools/call` returns an MCP error.

## GUI Inspector

The official MCP Inspector can be pointed at the same URL:

```bash
npx @modelcontextprotocol/inspector
```

Transport: **Streamable HTTP**, URL: `<MCP_URL>`. Then: Connect → **List Tools**
(confirms the four tools + annotations) → **Run Tool** on each.

## Captured sample I/O

Run against a local dev server (`MCP_URL=http://localhost:3111/api/mcp`), data
as of 2026-09-16. Tool-call bodies trimmed for readability.

```
── initialize → serverInfo ──
{ "name": "onchain-stock-data", "version": "0.1.0" }

── tools/list ──
[
  { "name": "portfolio_get",  "title": "Get weekly portfolio (US/JP)",            "readOnlyHint": true, "destructiveHint": false },
  { "name": "catalysts_list", "title": "List dated catalysts",                    "readOnlyHint": true, "destructiveHint": false },
  { "name": "scoreboard_get", "title": "Get Physical-AI scoreboard",              "readOnlyHint": true, "destructiveHint": false },
  { "name": "signal_get",     "title": "Get directional signals (x402 paid twin)","readOnlyHint": true, "destructiveHint": false }
]

── tools/call portfolio_get({"market":"us"}) ──
{ "market": "us", "week_of": "2026-09-14", "model": "claude-sonnet-5", "horizon": "1m",
  "holdings": [ { "ticker": "MSFT", "weight": 12, "target_date": "2026-10-28", … }, … ] }

── tools/call catalysts_list({"theme":"physical-ai","limit":3}) ──
{ "count": 3, "catalysts": [
  { "catalyst_id": "ext_46db1d3b", "ticker": "593A", "company_name": "ティアフォー",
    "target_date": "2026-07-22", "status": "hit", "series": "physical-ai" }, … ] }

── tools/call scoreboard_get({}) ──
{ "as_of": "2026-09-16",
  "overall": { "hit_rate": 0.797, "counts": { "hit": 24, "partial": 3, "miss": 5, "pending": 57 }, "judged": 32, "total": 89 },
  "articles": [ { "article": 1, "title": "Japan · Listed (earnings catalysts)", "hit_rate": 1, "judged": 12, "total": 13 }, … ] }

── tools/call signal_get({}) ──
{ "count": 7, "signals": [ { "id": "sig_ms_gpu_token_economics", "direction": "bullish",
    "scope": "AI-hardware", "tickers": ["NVDA"], "status": "pending" }, … ],
  "payment": { "network": "eip155:84532", "resource": "https://osd.x402jp.com/api/testnet/signal" } }

[mcp-inspect] OK — 4 tools, annotations present, all calls returned.
```

## §区分B — not verifiable in-sandbox (owner side)

These need production keys / an org / a real wallet, so they are **not** asserted
here (do not claim them until verified live):

1. **Production MCP reachability** — connect Claude / ChatGPT to
   `https://osd.x402jp.com/api/mcp`, confirm `tools/list` → call works.
2. **Connector-directory submission prerequisites** — Team/Enterprise org, OAuth
   (DCR or CIMD) with `https://claude.ai/api/mcp/auth_callback` registered, 3–5
   screenshots (≥1000px wide), a sample-data test account.
3. **OAuth × x402 coexistence (undecided — do not assert):** can the free tools
   be listed in the directory via OAuth while the paid twin (`signal_get` →
   `/api/testnet/signal`, and the mainnet per-call endpoints) stays x402-gated?
   Confirm with the Inspector / a real connector before writing a conclusion. If
   they cannot coexist, list only the free tools in the directory and keep x402
   as a separate channel.
4. **Real per-call settlement** — must be exercised on mainnet with a funded
   wallet (sandbox cannot).
