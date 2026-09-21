# Onchain Stock Data

**Live product:** https://osd.x402jp.com/

**Product boundary:** this is a research, selection, and measurement product.
It does not execute trades or provide personalised investment advice. Every
published portfolio, catalyst, and score should be read together with its
timestamp and recorded source data.

Claude が選ぶ米株・日本株ポートフォリオと、日付つきカタリストの採点記録を配信する API + Web ページ。

人はブラウザで **HTML ページを無料**で読み、AI エージェントは **MCP（無料・読み取り専用）** か **[x402](https://x402.org) の有料 JSON エンドポイント**で同じ研究データを取れます。有料は 3 レーン: Claude Portfolio / Catalyst 系 `/api/alpha/...` が **$0.01**（Base + Solana dual-leg）、per-call の `/api/catalyst/{ticker}`・`/api/edinet/{code}` が **0.001 USDC**（Solana のみ・`lib/x402.ts` の `PER_CALL_PRICE`）、`/api/testnet/signal` が **$0.05**（Base Sepolia・テストネットのデモ）。**`/api/alpha/...` は無料ではありません**（無料なのは HTML ページと MCP、および下記の無料 JSON 3 本）。

- Live site (canonical): https://osd.x402jp.com — x402 の `resource` URL が名乗るホスト (`X402_PUBLIC_BASE_URL`)
- Vercel デプロイ別名: https://osd-coral.vercel.app
- Repo: https://github.com/kato9292929/onchain-stock-data

> **公開 API のスコープ**: `/api/stocks`・`/api/ipo`・`/api/liquidity`・`/api/holders`・`/api/analyst`・`/api/predict`・`/api/alpha-posts`・`/api/wrappers/*` と、ページ `/stocks`・`/ipo`・`/liquidity`・`/holders`・`/analyst` は commit `1ac413d` (*feat(scope): trim public API to Portfolio + Catalysts only*) で**削除済み**です（現在 404）。`lib/analyst/`・`lib/predict.ts`・`lib/wrappers.ts` と `app/components/portfolio-pnl.tsx` はコードとしては残っていますが、**どの公開ルート／ページからも呼ばれていません**（`lib/tokensXyz.ts` は現役 — 下記 Data sources 参照）。

## Features

| Path | 内容 | 課金 |
|------|------|------|
| `/portfolio` | Claude が毎週選ぶ米株 10 銘柄。Allocation・thesis・1か月カタリスト | 無料 (HTML) |
| `/portfolio/jp` | Claude が毎週選ぶ日本株 10 銘柄。Allocation・catalyst hit-rate・thesis | 無料 (HTML) |
| `/alpha/portfolio/history` | portfolio 履歴 + SPY/QQQ 比較チャート（**日次更新は停止中・データは凍結**） | 無料 (HTML) |
| `/alpha/portfolio/[ticker]` | 銘柄詳細 (Claude full thesis・entry/current price) | 無料 (HTML) |
| `/catalysts` · `/catalysts/[sector]` | Physical AI シリーズの日付つきカタリストと採点記録 | 無料 (HTML) |
| `/api/mcp` | MCP サーバ (`portfolio_get`・`catalysts_list`・`scoreboard_get`・`signal_get`) | 無料・署名不要 |
| `/api/alpha/...` | 上記ページの JSON 版 + 外部 catalyst の投稿/判定 | **x402 有料 $0.01** |
| `/api/catalyst/{ticker}` · `/api/edinet/{code}` | 個別銘柄のカタリスト詳細 / EDINET 開示メタ | **x402 有料 0.001 USDC** |

`/alpha`・`/alpha/portfolio`・`/alpha/jp` は `/portfolio` へリダイレクトします (`next.config.ts`)。

## MCP server (`/api/mcp`)

osd の公開済みリサーチを **MCP ツール**として開放しています（Claude / ChatGPT から「話しかけるだけ」で読める）。`app/api/mcp/route.ts`、`mcp-handler` v2、Streamable HTTP。**MCP の 4 ツールはすべて無料・読み取り専用**（署名不要）で、呼び出しに Anthropic モデル呼び出しは発生しません（コスト 0）。

| tool | title | annotation | 内容 |
|---|---|---|---|
| `portfolio_get` | Get weekly portfolio (US/JP) | `readOnlyHint:true` / `destructiveHint:false` | 今週の米株/日本株ポートフォリオ（weights・thesis・catalyst 期日） |
| `catalysts_list` | List dated catalysts | 同上 | 期日つきカタリスト（`from`/`to`/`ticker`/`theme`/`limit` で絞り込み） |
| `scoreboard_get` | Get Physical-AI scoreboard | 同上 | Physical-AI カタリストの hit/partial/miss 集計 |
| `signal_get` | Get directional signals (x402 paid twin) | 同上 | 方向性シグナル。**有料 x402 版の双子**あり（下記） |

**無料 / 有料の線:**

- **無料（署名不要）** — MCP の 4 ツール（`portfolio_get`・`catalysts_list`・`scoreboard_get`・`signal_get`）と無料 descriptor（`/api/catalyst`・`/api/edinet`）。
- **有料（x402・HTTP 402 ゲート、per-call）** — `/api/catalyst/{ticker}`・`/api/edinet/{code}`。**USDC・Solana mainnet・`exact`・0.001 USDC**（= 1000 base units）で per-call 決済。価格は `lib/x402.ts` の **`PER_CALL_PRICE` に一元化**（ルート/ descriptor はこの定数を参照し、値を直書きしない）。`/api/edinet/{code}` は現状**書類メタ＋会計期間のみ**供給（`financials_available:false`）。
- **有料（testnet デモ）** — `signal_get` の双子 `/api/testnet/signal` は Base Sepolia USDC で別価格（`X402_TESTNET_SIGNAL_PRICE`、既定 `$0.05`）。MCP ツール側の読み取りは無料、支払いは HTTP エンドポイント側で発生。
- **サブスク課金は非採用**（アカウント・会員・月額課金の基盤もコードも文言も無い。スコープ外）。

**検証（MCP Inspector 手順・サンプル入出力）:** `docs/mcp-inspect.md`。ローカルは `npm run dev` の後 `MCP_URL=http://localhost:3000/api/mcp npm run mcp:inspect`（`initialize → tools/list → tools/call ×4` を回し、annotation 欠落・未定義ツール・402 不整合で fail loud）。GUI は `npx @modelcontextprotocol/inspector`（Streamable HTTP・URL に `/api/mcp`）。

**§区分B（キー・組織・実walletが要る／サンドボックス外・未確定＝断定しない）:**

1. 本番 MCP 疎通（Claude / ChatGPT → `https://osd.x402jp.com/api/mcp`）。
2. コネクタディレクトリ提出の前提（Team/Enterprise 組織、OAuth = DCR or CIMD ＋ `https://claude.ai/api/mcp/auth_callback` 登録、スクショ 3〜5 枚 ≥1000px、テストアカウント）。
3. **OAuth × x402 両立可否は未確定**。無料ツールを OAuth でディレクトリ掲載しつつ有料双子（`signal_get`／per-call）を x402 のまま両立できるかは、Inspector / 実接続で確定してから記述する。両立不可ならディレクトリには無料ツールのみ掲載し、x402 は別チャネルとして残す。
4. per-call の実決済確認は本番・実 wallet でのみ（サンドボックス不可）。

## API

すべて JSON を返します。有料エンドポイントは未署名リクエストに HTTP 402 の x402 challenge を返します。

**課金・決済レーンの区分:**

- **無料 (署名不要)** — `/api/mcp` の 4 ツールと、`/api/alpha/catalysts/physical-ai`・`/api/catalyst`・`/api/edinet` の 3 本。各 **HTML ページ**も無料。
- **有料 $0.01 (Base USDC + Solana USDC の dual-leg)** — Claude Portfolio / Catalyst 系の JSON API (`/api/alpha/...`)。402 に両チェーンの leg を提示し、caller が払ったチェーンを検証。
- **有料 0.001 USDC (Solana USDC のみ・`exact`)** — per-call の `/api/catalyst/{ticker}`・`/api/edinet/{code}`。価格は `lib/x402.ts` の `PER_CALL_PRICE` に一元化（ルート/descriptor はこの定数を参照し、値を直書きしない）。
- **有料 $0.05 (Base Sepolia USDC・テストネット)** — `/api/testnet/signal`。MCP の `signal_get` の有料双子で、**本番の実決済ではありません**。
- **内部専用** — `/api/cron/*`（`CRON_SECRET`）。有料エンドポイントは `X-Internal-Key` で課金スキップ可。

```text
# ── 無料 (署名不要) ──
GET  /api/alpha/catalysts/physical-ai   # Physical AI カタリスト scoreboard (hit-rate + 記事別内訳)
GET  /api/catalyst                      # カタリスト対象企業の索引 (ticker/社名/セクター/researched)
GET  /api/edinet                        # EDINET 有料エンドポイントの仕様・価格 descriptor
     /api/mcp                           # MCP (Streamable HTTP): portfolio_get / catalysts_list
                                        #                        scoreboard_get / signal_get

# ── 有料 $0.01: Base + Solana dual-leg ──
GET  /api/alpha/portfolio/current       # 現在の Claude US Portfolio (10 銘柄・JSON)
GET  /api/alpha/portfolio/scorecard     # US catalyst hit-rate + SPY/QQQ 累積比較
GET  /api/alpha/jp/portfolio/current    # 現在の Claude JP Portfolio (日本株・JSON)
GET  /api/alpha/jp/scorecard            # JP catalyst hit-rate (ベンチ指数なし)
GET  /api/alpha/jp/catalysts            # JP dated catalysts 一覧 (legacy 互換面)
POST /api/alpha/catalyst/submit         # 外部 catalyst を投稿 (Phase A)
GET  /api/alpha/catalyst/:id/score      # 投稿 catalyst の判定結果

# ── 有料 0.001 USDC: Solana USDC のみ (PER_CALL_PRICE) ──
GET  /api/catalyst/:ticker              # 個別銘柄のカタリスト + 開示済み財務
GET  /api/edinet/:code                  # EDINET 直近開示メタ + 会計期間 (財務数値は現状 null)

# ── 有料 $0.05: Base Sepolia (テストネット・デモ) ──
GET  /api/testnet/signal                # signal_get の有料双子

# ── 内部専用 ──
POST /api/cron/update-portfolio         # CRON_SECRET / INTERNAL_API_KEY
POST /api/cron/update-performance       # 同上

# ── 無料 (HTML ページ・x402 なし) ──
# /  /portfolio  /portfolio/jp  /catalysts  /catalysts/[sector]
# /alpha/portfolio/history  /alpha/portfolio/[ticker]
```

### Sample response (200・free)

無料の索引エンドポイント (`GET /api/catalyst`) の実測レスポンス（抜粋）。`paid_resource` が有料側の URL テンプレートを指し、`researched: true` の銘柄だけ有料詳細に中身があります。

```json
{
  "source": "onchain-stock-data · catalyst index",
  "note": "Free preview. Per-company catalyst + financials is a paid x402 call at /api/catalyst/{ticker}.",
  "paid_resource": "https://osd.x402jp.com/api/catalyst/{ticker}",
  "count": 197,
  "researched": 13,
  "companies": [
    { "ticker": "2760", "name": "東京エレクトロン デバイス", "sector": "卸売業", "researched": true },
    { "ticker": "2802", "name": "味の素", "sector": "食料品", "researched": true }
  ]
}
```

### Sample x402 challenge (402・agent)

実際の 402 は **x402 v2 のヘッダ transport** です。支払い要件はレスポンスボディではなく **`PAYMENT-REQUIRED` ヘッダ (base64(JSON))** に載り、**ボディは空 `{}`**（v2 仕様。空ボディはエラーではありません）。

```bash
$ curl -sD - https://osd.x402jp.com/api/catalyst/7203 -o /dev/null
HTTP/2 402
access-control-expose-headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE, ...
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwi...   # base64(JSON)
content-type: application/json
```

`payment-required` をデコードした中身（`/api/catalyst/:ticker` = Solana-only。下記は `lib/x402.ts` の定数から組み立てた構造例で、実測値の確認は本番で行ってください）:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://osd.x402jp.com/api/catalyst/:ticker",
    "description": "Per-company catalyst + latest disclosed financials (research). Settled per call in USDC on Solana (exact-svm).",
    "mimeType": ""
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "amount": "1000",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf",
      "maxTimeoutSeconds": 300,
      "extra": {
        "resource": "https://osd.x402jp.com/api/catalyst/:ticker",
        "feePayer": "<PayAI facilitator が /supported で配る値・毎回ローテート>"
      }
    }
  ]
}
```

- `/api/catalyst/:ticker`・`/api/edinet/:code` は **Solana USDC のみ**（上記の 1 leg・`amount` は `PER_CALL_PRICE.base_units` = `"1000"`）。起動時に `assertSolanaExactUsdc` が network / mint / 金額を検証し、ドリフトしていれば **fail closed**（500）になります。
- `/api/alpha/...` の dual-leg endpoint は、これに **Base (`eip155:8453`) USDC の leg** が加わった 2 leg を返します（`amount` は `"10000"` = $0.01）。
- 金額は atomic 文字列（USDC 6 桁。`"1000"` = 0.001 USDC、`"10000"` = $0.01）。`amount` が v2 の金額フィールド。
- `extra.feePayer` は Solana のスポンサー送金用に PayAI facilitator が `/supported` 経由でリクエスト毎に注入します（ローテートするため固定値ではない）。
- **ハンドラが 4xx を返すと決済はキャンセル**されます（`@x402/next` の `handleSettlement` が `status >= 400` で `cancel()`）。存在しない ticker / catalyst_id の空振りには課金されません。

> 決済が成立すると 200 レスポンスに `PAYMENT-RESPONSE` ヘッダ (base64(JSON)) が付き、Solana の場合は `transaction`（base58 tx 署名）が入ります。solscan で `payTo` への USDC 着金を確認できます。

x402 client 側からは `x402-fetch` でハンドリングできます:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);
const res = await fetchWithPay("https://osd.x402jp.com/api/catalyst/7203");
```

## Data sources

配信しているのは **自前のリサーチ成果**（Claude の選定・カタリスト採点）と、**一次開示のメタデータ**です。市場データの「配信」（価格・板・出来高の API）は現行スコープ外で、価格はページ表示の補助として参照しているだけです。

| データ | 中身 | 由来 |
|--------|------|------|
| Claude Portfolio (US / JP) | 週次の 10 銘柄選定・thesis・入替履歴 | `lib/jobs.ts` が Claude を呼び、`data/portfolio-history.json`・`data/jp-portfolio-history.json` に commit |
| Performance（**更新停止中**） | SPY/QQQ vs portfolio index の日次系列 | `data/performance-history.json`。`update-performance` workflow は **schedule 無効化済み**（本製品は予測記録を出すのが目的で、リターン追跡はしない）。`/alpha/portfolio/history` は凍結済みデータを表示します。 |
| Catalyst 採点 (Physical AI シリーズ) | 日付つきカタリストと hit/partial/miss/na 判定 | `data/external-catalysts.json`（`evaluate-catalysts` workflow が Claude + web search で判定し commit） |
| IR Fair カタリスト | 企業別カタリスト + 開示済み財務 (JPY 百万) | `data/ir-fair-2026-catalysts.json` |
| EDINET | 直近の提出書類メタ + 会計期間 | EDINET API v2 (`documents.json` type=2 + 書類取得 type=5 CSV)・週次キャッシュ |
| Signals | 事前生成の方向性シグナル | `data/signals.json`（`lib/signals.ts`。呼び出し時のモデル実行なし） |
| 株価・xStock variant | `/portfolio` の xStock 判定と `/alpha/portfolio/[ticker]` の current price | tokens.xyz Assets API（`lib/tokensXyz.ts` 経由・`TOKENS_XYZ_API_KEY`）。未設定なら `data/stocks.json` にフォールバック。 |
| External alt data (任意) | AA の `/api/latest-external-data` | `AA_EXTERNAL_DATA_URL`。週次 portfolio cron が best-effort で取得（10 秒タイムアウト・失敗時はスキップ） |

> **EDINET の財務数値は現在サーブしていません。** 抽出の信頼性確保のため一時停止中で、`sales` / `operating_income` / `net_income` は `null`・`financials_available:false` を返します（推測値を返すことはしません）。
>
> `data/liquidity.json`・`data/holders.json`・`data/ipo.json`・`data/alpha-posts.json`・`data/sample-analyst-output.json` は削除済みエンドポイント時代の残置ファイルで、**現行の公開ルート／ページからは読まれていません**。`data/stocks.json` だけは `TOKENS_XYZ_API_KEY` 未設定時のフォールバックとして現役です。

## 環境変数

| Var | 必須 | 用途 |
|-----|------|------|
| `ANTHROPIC_API_KEY` | yes | Claude API 呼び出し（週次 portfolio 選定 cron・catalyst 採点 workflow） |
| `TOKENS_XYZ_API_KEY` | opt | tokens.xyz Assets API。`/portfolio` の xStock 判定と `/alpha/portfolio/[ticker]` の current price に使用。未設定なら `data/stocks.json` にフォールバック。 |
| `INTERNAL_API_KEY` | opt | 内部認証 (`X-Internal-Key` ヘッダ)。有料エンドポイントの課金スキップ。未設定なら無効。 |
| `CRON_SECRET` | opt | `/api/cron/*` の認証 (`Authorization: Bearer <CRON_SECRET>`)。 |
| `BENCHMARK_PROVIDER` | opt | performance job の SPY/QQQ 取得元（既定 `yahoo`）。**同 job の schedule は無効化済み**で、手動実行時のみ使用。 |
| `AA_EXTERNAL_DATA_URL` | opt | 週次 portfolio cron が取り込む AA の external alt data。未設定ならスキップ。 |
| `X402_PUBLIC_BASE_URL` | opt | x402 の `resource` URL に使う正規オリジン（既定 `https://osd.x402jp.com`）。 |
| `SOLANA_RECEIVE_ADDRESS` | opt | Solana USDC の受取アドレス（402 の `payTo`）。未設定なら `WALLET_ADDRESS_SOLANA` → 既定値。 |
| `WALLET_ADDRESS_BASE` | opt | Base USDC の受取アドレス。 |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | opt | Base (EVM) の facilitator 認証。未設定なら `FACILITATOR_URL` → 匿名 CDP の順。 |
| `PAYAI_API_KEY_ID` / `PAYAI_API_KEY_SECRET` | opt | Solana の PayAI facilitator（無料 tier はキー不要）。 |
| `X402_TESTNET_SIGNAL_PRICE` | opt | `/api/testnet/signal` の価格（既定 `$0.05`）。 |
| `X402_TESTNET_PAY_TO` / `X402_TESTNET_FACILITATOR_URL` | opt | テストネット (Base Sepolia) の受取先・facilitator。 |
| `X402_SOLANA_NETWORK` / `SOLANA_USDC_MINT` | opt | devnet プレビュー用の上書き。本番は mainnet 既定のまま。 |

`.env.example` を参照。Vercel デプロイ時は Project Settings → Environment Variables から投入してください。

## Claude Portfolio (`/portfolio`)

毎週月曜朝 6 時 (JST) に Claude が選ぶ米株・日本株の各 10 銘柄。**HTML ページはブラウザ無料公開**、**JSON API (`/api/alpha/...`) はエージェント向けに x402 有料 ($0.01・Base + Solana)** (旧 claudestock.vercel.app を osd に統合)。

- `/portfolio` — 米国株: Allocation Breakdown ＋ 10 銘柄/thesis ＋ 各銘柄の検証可能な 1 か月カタリスト。**ファンドではなく選定記録**なので、P&L / ベンチマーク追跡は載せません。
- `/portfolio/jp` — 日本株: Allocation Breakdown ＋ catalyst hit-rate ＋ 10 銘柄/thesis (ベンチ指数なし)
- `/alpha/portfolio/history` — 過去の portfolio 履歴 + SPY/QQQ 比較チャート（recharts）。**日次の performance 更新は停止済みで、チャートは凍結データ**です。
- `/alpha/portfolio/[ticker]` — 銘柄詳細 (Claude full thesis・entry/current price)
- `GET /api/alpha/portfolio/current` — 同じ選定を JSON で (x402 有料 $0.01・agent / 外部 tool 用)

### 永続化は GitHub Actions (Vercel Cron ではない)

データは `data/portfolio-history.json`・`data/jp-portfolio-history.json`（週次）と `data/external-catalysts.json`（カタリスト判定）に保存し、**git commit して履歴を残します** (透明性)。**Vercel の FS は read-only/ephemeral で書き込みが残らない**ため、定期実行は **GitHub Actions** が唯一の正です (各 commit が Vercel 再デプロイをトリガし最新が反映)。`vercel.json` の cron 定義は撤去済み。

| workflow | schedule (UTC) | JST | 処理 |
|----------|----------------|-----|------|
| `update-portfolio.yml` | `0 21 * * 0` | 月 06:00 | `npm run update:portfolio` → 米株 10 銘柄選定 → `portfolio-history.json` を commit/push |
| `update-jp-portfolio.yml` | `15 21 * * 0` | 月 06:15 | `npm run update:jp-portfolio` → 日本株 10 銘柄選定 → `jp-portfolio-history.json` を commit/push |
| `evaluate-catalysts.yml` | `0 22 * * 0` | 月 07:00 | `npm run evaluate:catalysts` → 期日を過ぎた catalyst を Claude (web search) が hit/partial/miss/na 判定 → commit/push（`EVALUATE_MAX_PER_RUN` でバックログを分割消化） |
| `update-performance.yml` | **無効**（`schedule:` はコメントアウト） | — | `workflow_dispatch` のみ残置。リターン追跡をやめたため日次更新は停止。 |
| `x402-weekly-buyer.yml` · `x402-edinet-sweep.yml` | **無効**（コスト action） | — | mainnet の実 USDC を使う AA buyer。**スケジュールは意図的に無効**。有効化には wallet 資金・spend cap・devnet smoke・実測 1 回・オーナー承認が順に必要（`AGENTS.md` のコストガバナンス）。 |

各 workflow は `npm ci` 後に `tsx scripts/update-*.ts` 等を実行し、`lib/jobs.ts` の生成関数を**直接**呼びます (HTTP 経由で自分の API を叩かない = 循環・二重課金なし)。commit 先は `${GITHUB_REF_NAME}`（= 実行中のブランチ。本番は `main`）。手動実行は GitHub の Actions タブから `workflow_dispatch`。portfolio 系の workflow は同一 `concurrency` group で push 競合を回避。

**必要な GitHub Actions secrets:**

| secret | 必須 | 用途 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | yes | 週次の銘柄選定 (update-portfolio / update-jp-portfolio) と catalyst 判定 (evaluate-catalysts) |
| `BENCHMARK_PROVIDER` | opt | SPY/QQQ 取得元 (既定 `yahoo`)。`update-performance` を手動実行する場合のみ。 |

`/api/cron/update-portfolio` と `/api/cron/update-performance` は手動トリガ用に残置 (`CRON_SECRET` / `INTERNAL_API_KEY` 認証) ですが、Vercel 上では書き込みが残らないため永続化は GitHub Actions 側で行います。

## External Catalyst Scoring (Phase A)

AI エージェントや開発者が **catalyst（株価材料）を投げ込み、後日 Claude が hit/partial/miss/na を判定**する x402 有料 endpoint です（投稿・判定参照とも **$0.01**・Base + Solana dual-leg）。内部 Claude Portfolio の catalyst 採点パイプライン (`evaluate-catalysts`) を外部開放したもので、[AlternaData for agents](docs/alternadata-for-agents.md) 構想の Phase A にあたります。

### 投稿 — `POST /api/alpha/catalyst/submit`

```bash
curl -X POST https://osd.x402jp.com/api/alpha/catalyst/submit \
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
curl https://osd.x402jp.com/api/alpha/catalyst/ext_xxxxxxxx/score
```

`status` は `pending | hit | partial | miss | na`。`target_date + 7 日`経過後に週次 `evaluate-catalysts` workflow が Claude (web search) で判定し、`judgement_date` / `evidence_urls` / `reasoning` を埋めます。`evidence_urls` は web 検索結果に実在した URL のみ（hallucination 防止）。存在しない `catalyst_id` は `404`。

> 永続化は GitHub Actions が git commit する `data/external-catalysts.json`。Vercel の FS は read-only のため、submit 時の書き込みは best-effort（id はレスポンスで必ず返る）。

## External data / Solana payments

### Claude Portfolio cron への external data 統合

`/api/cron/update-portfolio`（週次）は実行時に `AA_EXTERNAL_DATA_URL`（AA の `/api/latest-external-data`）を fetch し、取得できれば Claude の選定プロンプトに「External alt data」context section として append します（Birdeye OHLCV サマリ + Perplexity ニュース/catalyst）。**10 秒タイムアウト・失敗時は external data 無しで選定続行**（graceful degradation）。詳細は [docs/alternadata-for-agents.md](docs/alternadata-for-agents.md)。

### Solana payments（供給側 / Solana で叩かれる側）

osd の有料 endpoint は Base に加えて **Solana USDC でも支払いを受け付けます**。x402 SDK は SVM の verify/settle scheme（`@x402/svm`）を同梱しており、`lib/x402.ts` で登録済みです。Solana の検証/settle は**公式 `@payai/facilitator` パッケージ**（`https://facilitator.payai.network`）に委ねます。

- **構成**：`x402ResourceServer` に **CDP（Base）を先頭、PayAI（Solana）を 2 つ目**にした facilitator client 配列を渡します。SDK が `initialize()` 時に各 `getSupported()` を読み、`solana:*` の verify を PayAI、`eip155:8453` を CDP へ自動ルーティング（先頭優先なので Base は CDP から動きません）。402 challenge の Solana leg は payTo=`SOLANA_RECEIVE_ADDRESS`、mint=Solana USDC、金額=価格。
- **PayAI 認証**：無料 tier はキー不要。本番拡張時のみ `PAYAI_API_KEY_ID` / `PAYAI_API_KEY_SECRET`（JWT auth）を設定します。
- **フォールバック**：PayAI client の構築に失敗した場合は配列が `[CDP]` のみに degrade し、**Base のみ実検証＝従来と完全に同一**（リグレッションなし）。Base の検証経路（CDP facilitator）は一切変更していません。

| env | 用途 |
|-----|------|
| `SOLANA_RECEIVE_ADDRESS` | Solana USDC の受取アドレス（402 challenge の payTo）。未設定なら `WALLET_ADDRESS_SOLANA` → デフォルトの順でフォールバック。 |
| `PAYAI_API_KEY_ID` / `PAYAI_API_KEY_SECRET` | PayAI の JWT 認証（本番拡張時のみ・無料 tier 不要）。 |

## Signals (`signal_get` / `/api/testnet/signal`)

`data/signals.json` に事前生成した方向性シグナルを置き、MCP の `signal_get`（無料・読み取り）と、その有料双子 `/api/testnet/signal`（**Base Sepolia・テストネット**・既定 `$0.05`）から配信します。呼び出し時に Anthropic モデルは実行しません（コスト 0）。テストネット側は mainnet の x402 スタックとは別インスタンス・別 facilitator で、本番の決済経路には影響しません。

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
# 無料エンドポイント (200)
curl -s http://localhost:3000/api/catalyst | head -c 400
curl -s http://localhost:3000/api/edinet | head -c 400
curl -s http://localhost:3000/api/alpha/catalysts/physical-ai | head -c 400

# MCP ハンドシェイク + 4 ツール呼び出し (docs/mcp-inspect.md)
MCP_URL=http://localhost:3000/api/mcp npm run mcp:inspect

# 有料エンドポイント (402 x402 challenge)
curl -sD - http://localhost:3000/api/catalyst/7203 -o /dev/null
```

> 有料ルートは起動時に facilitator の `getSupported()` を読みます。facilitator へ到達できないネットワーク（サンドボックス等）では 402 ではなく **500** になります。無料ルート・MCP・ページは影響を受けません。

## デプロイ (Vercel)

```bash
npx vercel
npx vercel --prod
```

データ更新は GitHub Actions が実行します（`update-portfolio`・`update-performance`・`evaluate-catalysts`）。各 workflow は `${GITHUB_REF_NAME}`（= 実行中のブランチ、本番は `main`）へ `data/*.json` を commit し、その commit が Vercel の再デプロイをトリガします。スクリプト本体は `scripts/update-*.ts`・`scripts/evaluate-catalysts.mjs`。

## Tech stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- `@x402/core` / `@x402/next` / `@x402/evm` / `@x402/svm` (x402 v2 resource server)
- `@coinbase/x402` (Base facilitator) + `@payai/facilitator` (Solana facilitator)
- `mcp-handler` + `@modelcontextprotocol/sdk` (`/api/mcp`)
- `@anthropic-ai/sdk` (週次選定 / カタリスト採点の cron)
- `recharts` (performance チャート), `lucide-react` (icons), `motion`

## 免責事項

- 本サイトの情報は **投資助言ではありません**。
- 表示値は参考であり、実際の取引執行前に各取引所・チェーン上で最新値を確認してください。
- xStocks は Backed Finance が発行する tokenized stocks で、**米国・英国・カナダ・オーストラリア・EU 等の居住者は購入できない場合があります**。各居住地域の規制を必ず確認してください。
- Backpack IPOs Onchain も同様に地域制限・KYC があります。

## License

No open-source license has been published for this repository yet. Reuse is
not granted until a license file is added.
