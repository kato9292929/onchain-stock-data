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
| `/liquidity` | tokens.xyz 集約 DEX プール (Jupiter / Raydium / Orca / Meteora) の TVL と公式価格 vs DEX 価格乖離 |
| `/holders`   | Helius RPC 由来の保有者数・上位ホルダー・集中度スコア                |
| `/alpha`     | オーナーが手動キュレーションした X 投稿の埋め込み                    |
| `/analyst`   | エージェント向け有料 IC memo (上記 5 API を並列で叩いて Claude で統合) |
| `/alpha/portfolio` | Claude が毎週月曜朝 6 時 (JST) に選ぶ米株 10 銘柄 (無料公開・SPY/QQQ 比較・履歴付き) |

## API

すべて JSON を返します。`User-Agent` で人 / エージェントを判定し、エージェントには HTTP 402 で x402 challenge を返します。

```text
GET  /api/stocks                  # 全銘柄
GET  /api/stocks?tokenized=true   # tokenized のみ
GET  /api/stocks/:ticker          # NVDA / TSLA / AAPL 等
GET  /api/ipo                     # Backpack IPOs Onchain calendar
GET  /api/liquidity               # DEX プール + 乖離率 (overview)
GET  /api/liquidity?ticker=NVDA   # 単一銘柄の流動性ランク済みプール
GET  /api/holders                 # 保有者マップ + 集中度
GET  /api/alpha-posts             # Alpha Signals (オーナーキュレーション)
POST /api/analyst                 # Claude が IC memo を生成 (有料)
POST /api/predict                 # Claude 銘柄予測 buy/hold/sell (有料・複数 ticker)
GET  /api/alpha/portfolio/current # 現在の Claude Portfolio (無料・JSON 公開)
GET  /api/alpha/portfolio/scorecard      # catalyst hit-rate + SPY/QQQ 比較 (無料)
POST /api/alpha/catalyst/submit          # 外部 catalyst を投稿 (無料・Phase A)
GET  /api/alpha/catalyst/:id/score       # 投稿 catalyst の判定結果 (無料・Phase A)
POST /api/wrappers/birdeye-ohlcv         # Birdeye OHLCV の x402 ラッパー ($0.01)
POST /api/wrappers/perplexity-research   # Perplexity research の x402 ラッパー ($0.05)
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

Solana 上のトークン化株式の解決と流動性ランクは **tokens.xyz Assets API** に集約しています。上場株財務は `yfinance`、IPO は Backpack、holders は Helius のまま。

`TOKENS_XYZ_API_KEY` を設定すると `/api/stocks`・`/api/stocks/:ticker`・`/api/liquidity` は tokens.xyz をライブソースとして使い、未設定時は同梱の `data/*.json` サンプルにフォールバックします。

- **Tokens API (tokens.xyz)** — Solana Foundation 管理の統一資産レジストリ (`api.tokens.xyz/v1`)。xStock + Ondo + PreStocks の全 variant を canonical な `assetId` に解決し、流動性ランク済みの markets (Jupiter / Raydium / Orca / Meteora を集約) を返す。**xStocks レジストリ解決・価格・出来高・DEX プール / 流動性は tokens.xyz が一次ソース**。
  - `/v1/assets/curated?list=stocks` → `/api/stocks`
  - `/v1/assets/resolve?ref=<ticker>` (+ `/variants`) → `/api/stocks/:ticker`
  - `/v1/assets/:assetId/markets?mint=<variant mint>` → `/api/liquidity?ticker=<sym>`
- **上場株財務** — `yfinance` (Python) または各取引所公式 API (tokens.xyz では取得不可・範囲外)
- **Backpack IPOs Onchain** — https://backpack.exchange/ipo-access (`/api/ipo`)
- **保有者マップ** — Helius RPC (`getTokenLargestAccounts`, `getProgramAccounts`) (`/api/holders`)
- **Alpha posts** — `data/alpha-posts.json` をオーナーが手動編集 (`/api/alpha-posts`)

> 旧構成の Birdeye (`public-api.birdeye.so`) / Jupiter price API (`lite-api.jup.ag`) / Raydium / Orca / Meteora の個別呼び出しと手動管理の `data/stocks.json` は tokens.xyz に置き換え済みです (`data/stocks.json` と `data/liquidity.json` は `TOKENS_XYZ_API_KEY` 未設定時の backward fallback としてのみ残置)。

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
| `TOKENS_XYZ_API_KEY`| yes* | tokens.xyz Assets API 認証 (`/api/stocks`・`/api/stocks/:ticker`・`/api/liquidity`)。未設定時は `data/*.json` にフォールバック。 |
| `ANTHROPIC_API_KEY` | yes  | Claude API 呼び出し (`POST /api/analyst`・`POST /api/predict`・週次 portfolio cron) |
| `INTERNAL_API_KEY`  | opt  | 内部認証 (`X-Internal-Key` ヘッダ)。未設定なら内部認証ルートは無効。 |
| `CRON_SECRET`       | opt  | Vercel Cron 認証 (`Authorization: Bearer <CRON_SECRET>`)。`/api/cron/*` で使用。 |
| `SMART_MONEY_URL`   | opt  | `/api/predict` depth=deep が叩く Nansen Smart Money screener。 |
| `BENCHMARK_PROVIDER`| opt  | 日次 performance cron の SPY/QQQ 取得元 (既定 `yahoo`)。 |

\* 本番では必須。Vercel の Project Settings → Environment Variables に `TOKENS_XYZ_API_KEY` を投入してください (`tok_...` 形式・リポジトリには直書きしない)。

`.env.example` を参照。Vercel デプロイ時は Project Settings → Environment Variables から投入してください。

## Predict (`POST /api/predict`)

複数銘柄の buy / hold / sell 予測を Claude が返す有料エンドポイント。osd 内部のデータソース (`/api/stocks` の価格・出来高、`/api/liquidity` の DEX 流動性、cross-market context、deep では Nansen Smart Money) を **1 回の Claude synthesis** に渡します (循環呼び出しや N+1 の Claude 呼び出しは避け、`lib/*` を直接利用)。

```bash
POST /api/predict
Content-Type: application/json

{
  "tickers": ["NVDA", "TSLA", "AAPL"],   // 必須
  "horizon": "1m",                         // 1w | 1m | 3m
  "depth":   "standard"                    // quick | standard | deep
}
```

| depth      | 価格 (USDC) | 上限 ticker 数 | 追加データ |
|------------|-------------|----------------|------------|
| `quick`    | **$0.50**   | 5              | 価格・24h 出来高 |
| `standard` | **$1.50**   | 10             | + DEX 流動性 + cross-market |
| `deep`     | **$3.00**   | 10             | + Nansen Smart Money (`SMART_MONEY_URL`) |

レスポンスは各 ticker の `predict` (buy/hold/sell)・`confidence` (low/medium/high)・`reasoning`・`data_summary`・`current/target price`。x402 は既存と同じ Base + Solana の 2 leg・depth 別課金 (`/api/analyst` と同パターン)。内部呼び出しは `X-Internal-Key` で課金スキップ。

## Claude Portfolio (`/alpha/portfolio`)

毎週月曜朝 6 時 (JST) に Claude が選ぶ米株 10 銘柄を **無料公開**します (旧 claudestock.vercel.app を osd に統合)。

- `/alpha/portfolio` — 現在の 10 銘柄 (ticker / weight / 1 行 thesis)
- `/alpha/portfolio/history` — 過去の portfolio 履歴 + SPY/QQQ 比較
- `/alpha/portfolio/[ticker]` — 銘柄詳細 (Claude full thesis・entry/current price)
- `GET /api/alpha/portfolio/current` — JSON で無料公開 (agent / 外部 tool 用)

`/alpha/portfolio/history` には recharts による Portfolio vs SPY / QQQ の比較チャートと、週ごとの銘柄入替 (新規 / 除外 / 増減) のタイムラインを表示します。

### 永続化は GitHub Actions (Vercel Cron ではない)

データは `data/portfolio-history.json` (週次) と `data/performance-history.json` (日次) に保存し、**git commit して履歴を残します** (透明性)。**Vercel の FS は read-only/ephemeral で書き込みが残らない**ため、定期実行は **GitHub Actions** が唯一の正です (各 commit が Vercel 再デプロイをトリガし最新が反映)。`vercel.json` の cron 定義は撤去済み。

| workflow | schedule (UTC) | JST | 処理 |
|----------|----------------|-----|------|
| `.github/workflows/update-portfolio.yml` | `0 21 * * 0` | 月 06:00 | `npm run update:portfolio` → 10 銘柄選定 → `portfolio-history.json` を commit/push |
| `.github/workflows/update-performance.yml` | `30 21 * * *` | 翌 06:30 | `npm run update:performance` → SPY/QQQ 記録 → `performance-history.json` を commit/push |

各 workflow は `npm ci` 後に `tsx scripts/update-*.ts` を実行し、`lib/jobs.ts` の生成関数を**直接**呼びます (`/api/predict` を HTTP で叩かない = 循環・二重課金なし)。手動実行は GitHub の Actions タブから `workflow_dispatch`。両 workflow は同一 `concurrency` group で push 競合を回避。

**必要な GitHub Actions secrets:**

| secret | 必須 | 用途 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | yes | 週次の銘柄選定 (update-portfolio) |
| `TOKENS_XYZ_API_KEY` | opt | current price 参照 (未設定なら `data/stocks.json` フォールバック) |
| `BENCHMARK_PROVIDER` | opt | SPY/QQQ 取得元 (既定 `yahoo`) |

`/api/cron/update-portfolio` と `/api/cron/update-performance` は手動トリガ用に残置 (`CRON_SECRET` / `INTERNAL_API_KEY` 認証) ですが、Vercel 上では書き込みが残らないため永続化は GitHub Actions 側で行います。`/api/predict` は有料 endpoint として従来どおり。

## External Catalyst Scoring (Phase A)

AI エージェントや開発者が **catalyst（株価材料）を投げ込み、後日 Claude が hit/partial/miss/na を判定**する無料 endpoint です。内部 Claude Portfolio の catalyst 採点パイプライン (`evaluate-catalysts`) を外部開放したもので、[AlternaData for agents](docs/alternadata-for-agents.md) 構想の Phase A にあたります。

### 投稿 — `POST /api/alpha/catalyst/submit`

```bash
curl -X POST https://osd-coral.vercel.app/api/alpha/catalyst/submit \
  -H "Content-Type: application/json" \
  -d '{"ticker":"NVDA","catalyst_description":"Q2 earnings beats consensus","target_date":"2026-08-28"}'
```

Body: `ticker`(1–10 英数字・必須) / `catalyst_description`(10–500 字・必須) / `target_date`(ISO 8601・未来日・必須) / `submitter_contact`(任意・500 字以内)。

レスポンス (201):

```json
{
  "catalyst_id": "ext_xxxxxxxx",
  "status": "pending",
  "estimated_eval_date": "2026-09-04",
  "score_lookup_url": "/api/alpha/catalyst/ext_xxxxxxxx/score"
}
```

同じ `ticker + catalyst_description + target_date` の重複は既存の `catalyst_id` を返します（新規作成しない）。abuse 防止として **同一 IP / 日あたり 10 件**まで（超過は `429`）。認証・x402 ペイウォールは Phase A1 で別途。

### 判定結果 — `GET /api/alpha/catalyst/:catalyst_id/score`

```bash
curl https://osd-coral.vercel.app/api/alpha/catalyst/ext_xxxxxxxx/score
```

`status` は `pending | hit | partial | miss | na`。`target_date + 7 日`経過後に日次 `evaluate-catalysts` workflow が Claude (web search) で判定し、`judgement_date` / `evidence_urls` / `reasoning` を埋めます。`evidence_urls` は web 検索結果に実在した URL のみ（hallucination 防止）。存在しない `catalyst_id` は `404`。

> 永続化は GitHub Actions が git commit する `data/external-catalysts.json`。Vercel の FS は read-only のため、submit 時の書き込みは best-effort（id はレスポンスで必ず返る）。

## x402 Data Wrappers (Phase 1)

外部 alt data API を x402 paywall でラップした有料 endpoint。AA（alt-data エージェント）がこれを daily で叩いて自前のパイプラインに供給します。API key は **server-side のみ**で使用し、レスポンスには含めません。CORS open・force-dynamic。`X-Internal-Key` で課金スキップ。

**支払いは Base USDC / Solana USDC のどちらでも可**（dual-leg）。402 challenge に両チェーンの leg を提示し、caller が払ったチェーンの proof を検証します（Base=CDP facilitator、Solana=`SOLANA_FACILITATOR_URL`）。詳細は下記「Solana payments」。

| endpoint | 価格 | 上流 | env |
|----------|------|------|-----|
| `POST /api/wrappers/birdeye-ohlcv` | **$0.01** / call (USDC on Base or Solana) | Birdeye OHLCV | `BIRDEYE_API_KEY` |
| `POST /api/wrappers/perplexity-research` | **$0.05** / call (USDC on Base or Solana) | Perplexity | `PERPLEXITY_API_KEY` |

```bash
# Birdeye OHLCV — Solana token, 30 本の日足
curl -X POST https://osd-coral.vercel.app/api/wrappers/birdeye-ohlcv \
  -H "Content-Type: application/json" \
  -d '{"address":"<solana_token_address>","type":"1D","limit":30}'
# → { "address": "...", "candles": [{ "ts","o","h","l","c","v" }, ...], "fetched_at": "..." }

# Perplexity research — 直近 24h のニュース + catalyst 提案 + citations
curl -X POST https://osd-coral.vercel.app/api/wrappers/perplexity-research \
  -H "Content-Type: application/json" \
  -d '{"ticker":"NVDA","lookback_hours":24}'
# → { "ticker","lookback_hours","events":[{title,date,source_url,catalyst_suggestion}],"citations":[...],"fetched_at":"..." }
```

### Claude Portfolio cron への external data 統合

`/api/cron/update-portfolio`（週次）は実行時に `AA_EXTERNAL_DATA_URL`（AA の `/api/latest-external-data`）を fetch し、取得できれば Claude の選定プロンプトに「External alt data」context section として append します（Birdeye OHLCV サマリ + Perplexity ニュース/catalyst）。**10 秒タイムアウト・失敗時は external data 無しで選定続行**（graceful degradation）。詳細は [docs/alternadata-for-agents.md](docs/alternadata-for-agents.md)。

### Solana payments（供給側 / Solana で叩かれる側）

osd の有料 endpoint は Base に加えて **Solana USDC でも支払いを受け付けます**。x402 SDK は SVM の verify/settle scheme（`@x402/svm`）を同梱しており、`lib/x402.ts` で登録済みです。実際に Solana 払いを検証するには、Solana 対応の x402 facilitator を `SOLANA_FACILITATOR_URL` に設定します。

- **設定時**：`x402ResourceServer` に 2 つ目の facilitator client として追加され、SDK が `solana:*` の verify をそちらへルーティング。402 challenge の Solana leg（payTo=`SOLANA_RECEIVE_ADDRESS`、mint=Solana USDC、金額=価格）が実際に検証可能になります。
- **未設定時**：facilitator client 配列は CDP（Base のみ）だけ。挙動は従来と完全に同一（Base のみ実検証）で、Solana leg は discovery に宣言されるが検証経路は無効 ＝ **リグレッションなし**。
- Base の検証経路（CDP facilitator）は一切変更していません。チェーン種別は SDK が proof の network を見て自動で振り分けます（EVM=CDP / Solana=Solana facilitator）。

| env | 用途 |
|-----|------|
| `SOLANA_RECEIVE_ADDRESS` | Solana USDC の受取アドレス（402 challenge の payTo）。 |
| `SOLANA_FACILITATOR_URL` | Solana の支払いを検証する x402 facilitator（例：PayAI）。未設定なら Solana 検証は無効。 |

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
