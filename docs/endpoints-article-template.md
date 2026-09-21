# エンドポイント紹介記事 — 雛形（人間向け）

Onchain Stock Data（OSD）の各エンドポイントを、note / ブログ / X で**人間の読者向け**に紹介するための雛形。
技術リファレンスは `README.md`、機械可読な仕様は `/.well-known/x402.json`、MCP の検証手順は `docs/mcp-inspect.md`。この文書は「読み物」用の下書き。

- 本番（x402 の `resource` URL が名乗る正規ホスト）: https://osd.x402jp.com
- Vercel デプロイ別名: https://osd-coral.vercel.app
- `【】` は記事ごとに差し替えるプレースホルダ。
- **数値・パスは公開前に必ず現物確認**。一次ソースはコード（`app/api/**/route.ts`・`lib/x402.ts`）→ `README.md` → `/.well-known/x402.json` の順。

> **重要（過去の事故）**: `/api/stocks`・`/api/ipo`・`/api/liquidity`・`/api/holders`・`/api/analyst`・`/api/predict`・`/api/alpha-posts`・`/api/wrappers/*` と、ページ `/stocks`・`/ipo`・`/liquidity`・`/holders`・`/analyst` は
> **公開 API のスコープ縮小（commit `1ac413d` "feat(scope): trim public API to Portfolio + Catalysts only"）で削除済み**です。現在は 404 になります。
> 旧バージョンの記事・雛形をコピーして使わないこと。以下の一覧が現在の提供面です。

---

## 0. 現在の提供面（2026-09 時点・コード実測）

### 無料（署名不要）

| 何が取れる | ページ（無料・ブラウザ） | API（無料・JSON） |
|---|---|---|
| Claude の米株ポートフォリオ | `/portfolio` | — |
| Claude の日本株ポートフォリオ | `/portfolio/jp` | — |
| 銘柄別の内訳・履歴 | `/alpha/portfolio/【NVDA】`・`/alpha/portfolio/history` | — |
| Physical AI カタリスト記録 | `/catalysts`・`/catalysts/【sector】` | `GET /api/alpha/catalysts/physical-ai` |
| カタリスト対象企業の索引 | — | `GET /api/catalyst` |
| EDINET エンドポイントの仕様・価格 | — | `GET /api/edinet` |
| MCP ツール 4 種（読み取り専用） | — | `/api/mcp`（`portfolio_get`・`catalysts_list`・`scoreboard_get`・`signal_get`） |

※ `/alpha`・`/alpha/portfolio`・`/alpha/jp` は `/portfolio` へリダイレクト（`next.config.ts`）。

### 有料（x402・HTTP 402 ゲート）

| API | 料金 | 決済レーン |
|---|---|---|
| `GET /api/alpha/portfolio/current` | **$0.01** | Base USDC + Solana USDC（dual-leg） |
| `GET /api/alpha/portfolio/scorecard` | **$0.01** | 同上 |
| `GET /api/alpha/jp/portfolio/current` | **$0.01** | 同上 |
| `GET /api/alpha/jp/scorecard` | **$0.01** | 同上 |
| `GET /api/alpha/jp/catalysts` | **$0.01** | 同上 |
| `POST /api/alpha/catalyst/submit` | **$0.01** | 同上 |
| `GET /api/alpha/catalyst/【:catalyst_id】/score` | **$0.01** | 同上 |
| `GET /api/catalyst/【:ticker】` | **0.001 USDC**（= 1000 base units） | **Solana USDC のみ**・`exact` |
| `GET /api/edinet/【:code】` | **0.001 USDC** | **Solana USDC のみ**・`exact` |
| `GET /api/testnet/signal` | **$0.05** | **Base Sepolia USDC**（テストネットのデモ） |

- **$0.01 の Claude Portfolio 系 JSON API は有料**です。「`/api/alpha/...` は無料公開」と書かないこと（HTML ページのほうが無料）。
- `0.001 USDC` の per-call 価格は `lib/x402.ts` の **`PER_CALL_PRICE` に一元化**されています。記事に数値を書くときはこの定数を見る。
- `/api/testnet/signal` は **テストネット**（Base Sepolia）。本番の実決済ではないので、記事で「本番で支払える」と書かない。
- `/api/cron/*` は内部専用（`CRON_SECRET`）。有料エンドポイントは `X-Internal-Key` で課金スキップ可。

### 機械可読な一覧（記事の裏取り用）

`/.well-known/x402.json` が同じ内容を返します: 有料は `endpoints`（`/api/alpha/...` ＋ per-call 2 本）、無料は `free_endpoints`、MCP は `mcp`、テストネットは `testnet_endpoints`。**記事の価格・パスはここと突き合わせれば裏が取れます**。

```bash
curl -s https://osd.x402jp.com/.well-known/x402.json | jq '{
  paid:    [.endpoints[]      | {path, amount: .accepts[0].amount}],
  free:    [.free_endpoints[] | .path],
  mcp:     .mcp.tools,
  testnet: [.testnet_endpoints[] | {path, price}]
}'
```

---

## A. 記事まるごとの雛形（OSD 全体を紹介する回）

### タイトル案
- 「Claude に毎週10銘柄選ばせて、当たり外れを公開しつづけている API を作った」
- 「日付つきカタリストを AI に採点させる — 人は無料で読み、エージェントは1コール0.001 USDC で買う」

### 導入（そのままリライトして使える）
> Onchain Stock Data（OSD）は、**Claude が選んだ米株・日本株のポートフォリオと、日付つきカタリストの採点記録**を公開している API + Web です。
> **人はブラウザで無料で閲覧**でき、**AIエージェントは [x402](https://x402.org) で 1 コールあたり数セント〜0.001 USDC を払って** 同じデータを JSON で取れます。
> 売買はしません。やっているのは「選ぶ・測る・記録を残す」の3つだけです。

### 3つの入り口
- **ブラウザ（無料）**: `/portfolio` `/portfolio/jp` `/catalysts` の HTML ページ。
- **MCP（無料）**: Claude / ChatGPT から `https://osd.x402jp.com/api/mcp` を繋ぐと、4つの読み取り専用ツールで同じ研究データが読めます（署名不要・モデル呼び出しなし）。
- **エージェント（x402 有料）**: `/api/...` の JSON。未払いだと HTTP 402 が返り、エージェントが自動で少額 USDC を支払って再取得します。人間が手で払う必要はありません（対応クライアントが自動処理）。

### エンドポイント早見表（記事本文用）
上の「0. 現在の提供面」をそのまま縮めて使う。**削除済みエンドポイントを足さない**。

### 決済のしくみ（人間向けにやさしく）
> エージェントが有料エンドポイントを叩くと、サーバは「これだけ払って」という **402（支払い要求）** を返します。
> 支払いは **USDC**。**Solana**（PayAI facilitator がガス代を肩代わりするので、払う側は SOL 不要）と **Base**（Ethereum L2）の両対応で、エンドポイントによってどちらを受けるかが決まっています。
> 対応クライアント（`x402-fetch` など）が自動で少額を送金し、着金が確認されると本来の JSON が返ります。オンチェーンなので支払いは solscan 等で追えます。

### 免責（末尾に付ける）
> 本記事・API の情報は投資助言ではありません。表示値は参考です。売買執行は行いません。各数値は必ずタイムスタンプと併せて読んでください。

---

## B. エンドポイント1個の紹介ブロック（毎回コピーして使う雛形）

> ### 【エンドポイント名】 — 【一言で何か】
>
> **どんなデータ**: 【何が返るか。人間の言葉で。例: 「その銘柄の直近カタリストと、達成/未達の判定条件」】
>
> **見る（無料・ブラウザ）**: `https://osd.x402jp.com/【catalysts】`
> **叩く（エージェント）**: `【GET】 /api/【catalyst/7203】` — 料金 **【0.001 USDC】**（【Solana のみ / Base + Solana / 無料】）
>
> **返ってくる主なフィールド**:
> - `【ticker】` — 【説明】
> - `【catalyst.due_date】` — 【説明】
> - `【catalyst.status】` — 【説明】
>
> **使いどころ**: 【読者にとっての価値】
>
> ```bash
> curl -s https://osd.x402jp.com/api/【catalyst】 | jq .
> ```

---

## C. 記入例（そのまま公開できる完成サンプル）

### `GET /api/catalyst` — カタリスト対象企業の索引（無料）

**どんなデータ**: OSD が追っている企業の一覧。ticker・社名・セクターと、「researched（調査済みデータがあるか）」のフラグが返ります。**無料・署名不要**で、有料の個別詳細（`/api/catalyst/{ticker}`）を叩く前の下見に使えます。

**見る（無料・ブラウザ）**: https://osd.x402jp.com/catalysts
**叩く（エージェント）**: `GET /api/catalyst` — 料金 **無料**

**返ってくる主なフィールド**:
- `count` / `researched` — 収録企業数と、うち調査済みの件数
- `companies[].ticker` — 銘柄コード
- `companies[].name` / `.sector` — 社名・セクター
- `companies[].researched` — `true` なら有料の個別詳細に中身がある
- `paid_resource` — 有料側の URL テンプレート（`.../api/catalyst/{ticker}`）

**使いどころ**: 「どの銘柄なら詳細が買えるのか」を無料で確認してから、必要な分だけ 0.001 USDC を払う。エージェントの無駄払いを防げる。

```bash
curl -s https://osd.x402jp.com/api/catalyst | jq '{count, researched, sample: .companies[0]}'
```

---

### `GET /api/catalyst/{ticker}` — 個別銘柄のカタリスト詳細（有料・0.001 USDC）

**どんなデータ**: 1社分の、日付つきカタリスト（期限・達成条件・未達条件・現在ステータス）と、開示済み財務（売上・営業利益・会計期間、単位は百万円）。

**見る（無料・ブラウザ）**: https://osd.x402jp.com/catalysts
**叩く（エージェント）**: `GET /api/catalyst/【7203】` — 料金 **0.001 USDC**（Solana USDC のみ・`exact`）

**返ってくる主なフィールド**:
- `catalyst.due_date` — カタリストの期限
- `catalyst.success_condition` / `.fail_condition` — 何を以て達成/未達とするか
- `catalyst.status` — 現在の判定
- `financials.revenue` / `.operating_income` / `.fiscal_period` — 開示済みの数字（`unit: "JPY_millions"`）
- `source` — 出典

**使いどころ**: 「この日までにこれが起きたら達成」という条件が機械可読で入っているので、エージェントが期日監視・自動採点のトリガーに使える。

```bash
# 未払いなら 402（支払い要求ヘッダが返る）
curl -sD - https://osd.x402jp.com/api/catalyst/7203 -o /dev/null | head -5
```

> ※ 存在しない ticker は `404`。404 は x402 の決済をキャンセルするため、**空振りには課金されません**（記事で書く価値のあるポイント）。

---

## D. 記事にするときの注意（書き手向けメモ）

- **まず「0. 現在の提供面」と現物を突き合わせる**。この雛形自体、過去に削除済みエンドポイント（`/api/stocks`・`/api/ipo` など）を載せたまま放置され、記事に書けば嘘になる状態だった。一次ソースは **コード**（`app/api/**/route.ts`・`lib/x402.ts`）。
- **「エージェントが払う」体験を主役に**。人間が USDC を手で送る話にしない（自動決済が売り）。
- **Solana のガスレス**（PayAI feePayer 肩代わり）は差別化ポイントなので触れる価値あり。
- **MCP（無料・読み取り専用）と x402（有料）の線を混ぜない**。MCP の 4 ツールは無料で、有料なのは HTTP 側。`signal_get` の有料双子 `/api/testnet/signal` は **テストネット**であることを必ず添える。
- Claude Portfolio の **HTML ページは無料・JSON API は $0.01 有料**。逆に書かない。
- 投資助言に読めない表現にする（免責を必ず付ける）。売買執行はしないと明記する。
