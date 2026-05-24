# Onchain Stock Data

Solana 上の株式トークン (xStocks) と Backpack IPOs Onchain の情報を統合した API + Web ページ。

ブラウザからは無料の HTML ページ、エージェント (Claude / GPT / curl / Python requests 等) からは [x402](https://x402.org) で `$0.01` / call の有料 JSON エンドポイントとして配信します。

- Live site: https://onchain-stock-data.vercel.app (デプロイ後に差し替え)
- Repo: https://github.com/kato9292929/onchain-stock-data

## Features

| Path         | 内容                                                                 |
|--------------|----------------------------------------------------------------------|
| `/stocks`    | xStocks 60+ — mint address, 現在価格, 24h vol, venues, 上場株財務 |
| `/ipo`       | Backpack IPOs Onchain (Superstate × Solana) waitlist                 |
| `/liquidity` | Jupiter / Raydium / Orca プールの TVL と公式価格 vs DEX 価格乖離     |
| `/holders`   | Helius RPC 由来の保有者数・上位ホルダー・集中度スコア                |
| `/alpha`     | オーナーが手動キュレーションした X 投稿の埋め込み                    |
| `/analyst`   | エージェント向け有料 IC memo (上記 5 API を並列で叩いて Claude で統合) |

## API

すべて JSON を返します。`User-Agent` で人 / エージェントを判定し、エージェントには HTTP 402 で x402 challenge を返します。

```text
GET  /api/stocks                  # 全銘柄
GET  /api/stocks?tokenized=true   # tokenized のみ
GET  /api/stocks/:ticker          # NVDA / TSLA / AAPL 等
GET  /api/ipo                     # Backpack IPOs Onchain calendar
GET  /api/liquidity               # DEX プール + 乖離率
GET  /api/holders                 # 保有者マップ + 集中度
GET  /api/alpha-posts             # Alpha Signals (オーナーキュレーション)
POST /api/analyst                 # Claude が IC memo を生成 (有料)
```

### Sample response (200・browser)

```json
{
  "source": "sample-data",
  "updated_at": "2026-05-23T19:00:00Z",
  "stocks": [
    {
      "underlying_ticker": "NVDA",
      "company_name": "NVIDIA Corporation",
      "price_usd": 142.36,
      "tokenized_versions": [
        {
          "token_symbol": "NVDAx",
          "chain": "Solana",
          "mint_address": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
          "current_price_usd": 142.18,
          "venues": ["Kraken", "Bybit", "Jupiter", "Raydium", "Phantom"]
        }
      ]
    }
  ]
}
```

### Sample x402 challenge (402・agent)

```bash
$ curl -s http://localhost:3000/api/stocks
```

```json
{
  "x402Version": 1,
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "asset_symbol": "USDC",
      "maxAmountRequired": "10000",
      "maxAmountRequiredUsd": "0.01",
      "resource": "/api/stocks"
    },
    {
      "scheme": "exact",
      "network": "solana",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "asset_symbol": "USDC",
      "maxAmountRequired": "10000",
      "maxAmountRequiredUsd": "0.01"
    }
  ]
}
```

x402 client 側からは `x402-fetch` でハンドリングできます:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);
const res = await fetchWithPay("https://onchain-stock-data.vercel.app/api/stocks");
```

## Data sources

このリポジトリ初期版は `data/*.json` をサンプルデータとして同梱しています。本番運用前に以下のソースで再生成してください:

- **xStocks レジストリ** — Backed Finance 公式 (`xstocks.fi`) + Helius RPC (mint metadata)
- **xStocks 価格・出来高** — Jupiter price API (`lite-api.jup.ag`), Birdeye (`public-api.birdeye.so`)
- **上場株財務** — `yfinance` (Python) または各取引所公式 API
- **Backpack IPOs Onchain** — https://backpack.exchange/ipo-access
- **流動性プール** — Jupiter aggregator / Raydium / Orca SDK
- **保有者マップ** — Helius RPC (`getTokenLargestAccounts`, `getProgramAccounts`)
- **Alpha posts** — `data/alpha-posts.json` をオーナーが手動編集

## Analyst (`POST /api/analyst`)

エージェント向け有料エンドポイント。リクエスト時に上記 5 API を並列で叩き、Claude (Anthropic) で構造化された IC memo に統合して返します。

### Request

```bash
POST /api/analyst
Content-Type: application/json

{
  "ticker": "SPCX",      // 必須
  "depth":  "standard"   // 任意 — quick | standard | deep (default: standard)
}
```

### Pricing & depth

| depth      | sources                                                | time      | price (USDC) |
|------------|--------------------------------------------------------|-----------|--------------|
| `quick`    | 5 internal endpoints                                   | 3-5 min   | **$0.50**    |
| `standard` | + SEC EDGAR filings (recent)                           | 10-15 min | **$1.50**    |
| `deep`     | + earnings call transcript + comparable financials     | 20-30 min | **$3.00**    |

決済は Base USDC または Solana USDC を [x402](https://x402.org) で受領。

### Auth modes

| Caller                                       | Behavior |
|----------------------------------------------|----------|
| Browser (Mozilla / Safari / Chrome UA)       | `GET /analyst` ページ (HTML) を返す。`POST /api/analyst` は HTML を返さず、後述の挙動。 |
| Agent (`curl`, Claude, GPT, Python requests) | HTTP 402 x402 challenge を返す。x402 payment 完了後にレポート生成。 |
| Internal (`X-Internal-Key: $INTERNAL_API_KEY`) | 課金スキップ・HTTP 200 で直接レポート生成。自社 backend や AA から使う想定。 |

### Sample call

```bash
# Internal (free, AA / self-hosted)
curl -X POST https://onchain-stock-data.vercel.app/api/analyst \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  -d '{"ticker": "SPCX", "depth": "standard"}'

# Agent (x402-charged)
curl -X POST https://onchain-stock-data.vercel.app/api/analyst \
  -H "Content-Type: application/json" \
  -d '{"ticker": "SPCX", "depth": "standard"}'
# → HTTP 402, body includes Base USDC + Solana USDC accept options
```

`data/sample-analyst-output.json` に SPCX standard のサンプル出力を同梱しています (このリポジトリの初期版はハンドクラフト — 実 Claude 生成版に置き換えるには `ANTHROPIC_API_KEY` を設定したデプロイ環境で上記 curl を実行)。

### 位置付け (vs agentic.market)

- `agentic.market` は米国上場株中心の AI 投資分析エージェント。
- 本 Analyst は **APAC + Solana onchain (xStocks) + Backpack IPOs Onchain** にデータ起点を持つことで補完関係。
- 共通スキーマで IC memo を出すため、agentic と組み合わせて多面評価できます。

### 環境変数

| Var                 | 必須 | 用途 |
|---------------------|------|------|
| `ANTHROPIC_API_KEY` | yes  | Claude API 呼び出し (`POST /api/analyst`) |
| `INTERNAL_API_KEY`  | opt  | 内部認証 (`X-Internal-Key` ヘッダ)。未設定なら内部認証ルートは無効。 |

`.env.example` を参照。Vercel デプロイ時は Project Settings → Environment Variables から投入してください。

## Alpha Signals

`/alpha` セクションは「オーナーが注目している X 投稿」のキュレーション枠です。

- post の追加・削除は `data/alpha-posts.json` を直接編集
- スキーマは `{ "url": "https://x.com/<account>/status/<id>", "added_at": "ISO 8601" }`
- 表示は Twitter (X) 公式の `widgets.js` 埋め込み (blockquote 形式・dark theme)
- **Claude Code / 自動 bot は post を追加・削除しません**

## ローカル開発

```bash
git clone https://github.com/kato9292929/onchain-stock-data
cd onchain-stock-data
npm install
npm run dev
# → http://localhost:3000
```

ビルド確認:

```bash
npm run build
```

エンドポイント手動テスト:

```bash
# 人として叩く (200)
curl -A "Mozilla/5.0" http://localhost:3000/api/stocks | head

# エージェントとして叩く (402 x402 challenge)
curl http://localhost:3000/api/stocks
```

## デプロイ (Vercel)

```bash
npx vercel
npx vercel --prod
```

`data/*.json` を cron / GitHub Actions で毎朝更新する想定 (1 日 1 回・06:00 JST など)。更新スクリプト本体はこのリポジトリには未同梱。

## Tech stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- `@solana/web3.js` (mint metadata)
- `x402-next`, `x402-fetch` (payment handshake)
- `lucide-react` (icons)

## 免責事項

- 本サイトの情報は **投資助言ではありません**。
- 表示値は参考であり、実際の取引執行前に各取引所・チェーン上で最新値を確認してください。
- xStocks は Backed Finance が発行する tokenized stocks で、**米国・英国・カナダ・オーストラリア・EU 等の居住者は購入できない場合があります**。各居住地域の規制を必ず確認してください。
- Backpack IPOs Onchain も同様に地域制限・KYC があります。

## License

MIT (予定)
