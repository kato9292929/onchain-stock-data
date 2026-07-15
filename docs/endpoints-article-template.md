# エンドポイント紹介記事 — 雛形（人間向け）

Onchain Stock Data（OSD）の各エンドポイントを、note / ブログ / X で**人間の読者向け**に紹介するための雛形。
技術リファレンスは `README.md`、機械可読な仕様は `/.well-known/x402.json`。この文書は「読み物」用の下書き。

- 本番: https://osd-coral.vercel.app
- `【】` は記事ごとに差し替えるプレースホルダ。
- 価格・出力は README / 実 API に合わせて更新すること（この雛形の数値も現物確認してから使う）。

---

## A. 記事まるごとの雛形（OSD 全体を紹介する回）

### タイトル案
- 「Solana 上の“株式データ”を、人にもAIエージェントにも配る API を作った」
- 「xStocks / IPO / 流動性 / AI分析 — OSD エンドポイント全部紹介」

### 導入（そのままリライトして使える）
> Onchain Stock Data（OSD）は、Solana 上のトークン化株式（xStocks）や Backpack IPOs Onchain の情報を1か所に集めた API + Web です。
> **人はブラウザで無料で閲覧**でき、**AIエージェントは [x402](https://x402.org) で 1 コール数セントの USDC を払って** 同じデータを JSON で取れます。
> 「人間の目」と「エージェントの財布」の両方に、同じ一次データを届けるのが狙いです。

### 2つの入り口
- **ブラウザ（無料）**: `/stocks` `/ipo` `/liquidity` `/holders` `/alpha` `/analyst` などの HTML ページ。
- **エージェント（x402 有料）**: `/api/...` の JSON。未払いだと HTTP 402 が返り、エージェントが自動で少額 USDC を支払って再取得します。人間が手で払う必要はありません（対応クライアントが自動処理）。
- **Claude Portfolio 系は API も無料公開**（`/api/alpha/...`）。

### エンドポイント早見表（記事本文用）
| 何が見られる | ページ（無料） | API | 料金 |
|---|---|---|---|
| 株トークン一覧・価格・DEX venue | `/stocks` | `GET /api/stocks` | $0.01 |
| 個別銘柄の詳細 | `/stocks/【NVDA】` | `GET /api/stocks/【NVDA】` | $0.01 |
| Backpack IPO カレンダー | `/ipo` | `GET /api/ipo` | $0.01（Solana のみ） |
| DEX 流動性・価格乖離 | `/liquidity` | `GET /api/liquidity` | $0.01（Solana のみ） |
| 保有者マップ・集中度 | `/holders` | `GET /api/holders` | $0.01（Solana のみ） |
| AI の IC memo | `/analyst` | `POST /api/analyst` | $0.50〜$3.00 |
| AI の売買予測 | — | `POST /api/predict` | $0.50〜$3.00 |
| Claude の米株ポートフォリオ | `/alpha/portfolio` | `GET /api/alpha/portfolio/current` | **無料** |
| Claude の日本株ポートフォリオ | — | `GET /api/alpha/jp/portfolio/current` | **無料** |

### 決済のしくみ（人間向けにやさしく）
> エージェントが有料エンドポイントを叩くと、サーバは「これだけ払って」という **402（支払い要求）** を返します。
> 支払いは **USDC**。**Solana**（PayAI facilitator がガス代を肩代わりするので、払う側は SOL 不要）と **Base**（Ethereum L2）の両対応。
> 対応クライアント（`x402-fetch` など）が自動で少額を送金し、着金が確認されると本来の JSON が返ります。オンチェーンなので支払いは solscan 等で追えます。

### 免責（末尾に付ける）
> 本記事・API の情報は投資助言ではありません。表示値は参考です。xStocks / Backpack IPOs Onchain には地域制限・KYC があります。各居住地域の規制を確認してください。

---

## B. エンドポイント1個の紹介ブロック（毎回コピーして使う雛形）

> ### 【エンドポイント名】 — 【一言で何か】
>
> **どんなデータ**: 【何が返るか。人間の言葉で。例: 「NVDAx など xStocks の現在価格と、どの DEX / 取引所で買えるか」】
>
> **見る（無料・ブラウザ）**: `https://osd-coral.vercel.app/【stocks】`
> **叩く（エージェント）**: `【GET】 /api/【stocks】` — 料金 **【$0.01】**（【Base + Solana / Solana のみ / 無料】）
>
> **返ってくる主なフィールド**:
> - `【underlying_ticker】` — 【説明】
> - `【price_usd】` — 【説明】
> - `【tokenized_versions[]】` — 【説明】
>
> **使いどころ**: 【読者にとっての価値。例: 「オンチェーンで買える米国株の“今の気配値”を、取引所を横断して1回で取れる」】
>
> ```bash
> curl -A "Mozilla/5.0" https://osd-coral.vercel.app/api/【stocks】 | jq .
> ```

---

## C. 記入例（そのまま公開できる完成サンプル）

### `/api/ipo` — Backpack IPOs Onchain のカレンダー

**どんなデータ**: SpaceX・Stripe・OpenAI など、Backpack IPOs Onchain（Superstate × Solana）で待機リスト/上場予定になっている銘柄の一覧。ticker・会社名・セクター・上場予定日・発行プラットフォームが返ります。

**見る（無料・ブラウザ）**: https://osd-coral.vercel.app/ipo
**叩く（エージェント）**: `GET /api/ipo` — 料金 **$0.01**（Solana USDC のみ）

**返ってくる主なフィールド**:
- `ipos[].ticker` — 銘柄コード（例: `SPCX`）
- `ipos[].company_name` — 会社名（例: `Space Exploration Technologies Corp. (SpaceX)`）
- `ipos[].planned_listing_date` — 上場予定日
- `ipos[].primary_issuance_platforms[]` — 発行プラットフォーム / パートナー / ステータス

**使いどころ**: 「オンチェーンで参加できそうな IPO」を、日付とステータス付きで機械可読に取れる。ウォッチリスト bot やニュースレターの自動生成に。

```bash
curl -A "Mozilla/5.0" https://osd-coral.vercel.app/api/ipo | jq '.ipos[].ticker'
```

> ※ `source` フィールドが `"sample-data"` の間は同梱サンプル。ライブ取得元のキーが入ると実データ名に変わります。

---

## D. 記事にするときの注意（書き手向けメモ）

- **価格・出力・URL は公開前に現物確認**（この雛形の数値をそのまま信じない）。一次ソースは `README.md` と `/.well-known/x402.json`。
- **「エージェントが払う」体験を主役に**。人間が USDC を手で送る話にしない（自動決済が売り）。
- **Solana のガスレス**（PayAI feePayer 肩代わり）は差別化ポイントなので触れる価値あり。
- 無料の Claude Portfolio（US / JP）は「透明性・実績トラッキング」の文脈で別記事にもできる。
- 投資助言に読めない表現にする（免責を必ず付ける）。
