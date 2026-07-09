# OSD Solana x402 空402 / v1・v2 regression — 調査・修正ステータス

最終更新: 2026-07-09
対象: `kato9292929/onchain-stock-data`（OSD本体）
関連: `kato9292929/x402-Autonomous-Agent-`（AA、参照専用）／ JIN Movers（別プロダクト、402型の参照先）

> このドキュメントは引き継ぎ用。別エージェント／人間が read して現状を把握できるように書いている。
> 「確定」＝実コード or 実出力で裏取り済み。「未確定／推測」は明記する。

---

## 1. TL;DR（結論だけ）

- 症状: 本番 `GET /api/ipo`・`/api/holders`・`/api/liquidity` の402が、AAの決済経路とミスマッチして決済に進めない（初期観測は本文空 `{}`）。7/6-7/7に劣化。
- 真因（確定）: これら3ルートの402 accepts を `@x402/next` の `withX402` が **facilitatorの `getSupported` から動的に組んでいる**。PayAI(Solana) facilitator が **v2 Solana kind を追加** → getSupported 経由で伝播 → OSDの402が **v2形（`amount` / CAIP-2 network）へ自動切替** → **AAの v1 登録（`maxAmountRequired` / 別network alias）とミスマッチ**。コード変更ではなく実行時（facilitator応答）変化由来。
- 対策（実装済み・本セッションで再構築、work branch へ push 済み）: 3ルートの**未払いチャレンジの accepts を facilitator非依存で自前構築**。**1本の402の `accepts[]` に v1 leg（先頭）と v2 leg（併記）を両方載せる**。body top-level `x402Version` は **v1 固定**（現行AA互換）。型は全て一次ソース（@x402/svm / @x402/core 2.13.0 実コード）から確定。**X-PAYMENT提示時の verify/settle は従来の @x402/svm + PayAI に委譲（決済ロジック無変更）**。Base側は無変更。
- 残: ①`X402_SOLANA_FEE_PAYER`(=PayAI feePayer) env設定 ②本番デプロイ判断（運用者）③デプロイ後 pay→200→solscan着金確認（運用者）④本番実402との最終照合（運用者curl）。

---

## 2. 背景（regressionの前提）

- OSDの3 Solanaエンドポイントは過去に実際にSolana mainnetで決済成功していた（@x402/svm 部分署名 + PayAI facilitator が feePayer、base58 tx が solscan確認済み）。記事 `note.com/x402inc/n/n5db3cc067263` に3本のtxHash。
- 動作していた版 = コミット **`d72b418`（2026-06-14）** "Present Solana-only accepts on /api/ipo,/api/holders,/api/liquidity"（PR #10）。直前にPayAI facilitator統合（`0eb72d2`/`2eaf0c3`, 6/12-13）。
- **6/14動作版と regression 直後で `lib/x402.ts`・`lib/x402-route.ts`・3ルートは実質一致**（間のコミットは cron の `data/*.json` 更新が主）。→ **regressionはコード変更由来ではない**。実行時（facilitator応答）の変化。

---

## 3. 確定した事実（すべて @x402 2.13.0 実コードで裏取り済み）

### 3-1. 空402の発生源（@x402/next 実コード）
`node_modules/@x402/next/dist/esm/index.js` — `withX402` → `withX402FromHTTPServer` → `processHTTPRequest()` が `payment-error` のとき `handlePaymentError` が返す:
```js
return new NextResponse(JSON.stringify(response.body || {}), { status: response.status, headers });
```
→ accepts を組めず `response.body` が falsy だと body が `{}`。accepts は facilitator の supported kinds 依存。

### 3-2. @x402/svm の登録形（実測: 2.13.0）
`@x402/svm/dist/esm/exact/server/index.mjs`（register.ts コンパイル後）:
```js
function registerExactSvmScheme(server, config = {}) {
  ...
  server.register("solana:*", new ExactSvmScheme());   // CAIP-2 wildcard（v2 scheme）
}
```
→ **2.13.0 のデフォルト登録は `"solana:*"`（CAIP-2）**。※以前のステータスに書いた `register({x402Version:1, network:"solana"})` は当該バージョンには存在しない旧記述だった（訂正）。

### 3-3. v1 と v2 の別モジュール・別フィールド（実測: 2.13.0）
- **v1**: `@x402/svm/dist/cjs/v1/index.js`
  - `V1_TO_V2_NETWORK_MAP = { solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana-devnet": …, "solana-testnet": … }`
  - `normalizeNetwork()` が bare `"solana"` → mainnet CAIP-2 に正規化（CAIP-2直指定も可）。
  - `ExactSvmSchemeV1.createPaymentPayload()` は `BigInt(selectedV1.maxAmountRequired)` と `selectedV1.extra?.feePayer` を読む。
  - → **v1 leg の network は bare `"solana"`、金額フィールドは `maxAmountRequired`。**
- **v2**: `@x402/svm/dist/esm/exact/client`（chunk-MPB7KQPX）
  - `BigInt(paymentRequirements.amount)` と `paymentRequirements.extra?.feePayer` を読む。
  - → **v2 leg の金額フィールドは `amount`。**

### 3-4. accepts要素の型（@x402/core `schemas/index.ts` 実測: 2.13.0）
`@x402/core/dist/cjs/schemas/index.(js|d.ts)`（※`types/v2` ディレクトリは存在しない。v2型は `schemas` にある）:
```ts
PaymentRequirementsV1Schema = z.object({
  scheme, network /* NetworkSchemaV1 = 任意の非空文字列 */, maxAmountRequired,
  resource, description, mimeType?, outputSchema?, payTo, maxTimeoutSeconds(+), asset, extra?
});
PaymentRequirementsV2Schema = z.object({
  scheme, network /* NetworkSchemaV2 = ":"必須のCAIP-2 */, amount,
  asset, payTo, maxTimeoutSeconds(+), extra?
});
```
- **どちらも plain `z.object`（`.strict()` ではない）→ 未知キーは reject でなく strip。** よって v1 leg に `amount` を余分に載せても安全、v2 leg に v1 フィールド一式を載せても安全（各clientが自分の知るフィールドを読む）。
- `PaymentRequiredV1Schema = { x402Version: literal(1), error?, accepts: array(V1).min(1) }`（top-level `resource` 無し）。
- `PaymentRequiredV2Schema = { x402Version: literal(2), error?, resource: ResourceInfo, accepts: array(V2).min(1), extensions? }`。

### 3-5. extra.feePayer は sponsored-transfer に必須 かつ ローテーションする
両 svm client（v1/v2）とも `extra.feePayer` を読み、無ければ tx を組めない（`"feePayer is required"`）。stock `withX402` 経路では facilitator の getSupported().extra から注入される。
**重要（実測）: feePayer は同日内でローテーションする** — 2026-07-09 に `D6ZhtNQ5nT…` → `BFK9TLC3…` → `2wKupLR9q6…` の3値を観測。→ **env固定にすると回転した瞬間に古い名義を tx に焼き込み、PayAI が署名を完成できず settle不能**（先週の「気づいたら壊れてた」の再生産）。よって feePayer は **402構築時に facilitator から動的取得**する（下記 §4 `getSolanaFeePayer`）。
`getSupported()` の戻り値形状（`@x402/core` http 実測）: `{ kinds: [{ x402Version, scheme, network, extra? }], extensions, signers }`。solanaエントリの `extra.feePayer` を採る。

---

## 4. 実装した対策（work branch push 済み）

### 変更ファイル（3つのみ）
- `lib/x402.ts`: `buildSolanaAcceptsV1()` 追加（＋ `X402_VERSION=1`, `SOLANA_SCHEME_NETWORK="solana"`, `SOLANA_CAIP2_NETWORK`）。**feePayer はハイブリッド動的解決**（`getSolanaFeePayer()`）: 402構築時に `payaiFacilitatorClient.getSupported()` の solana `extra.feePayer` を取得 → 短TTL(3分)メモリキャッシュ → 取得失敗時は `solanaFeePayerFallback()`（env `X402_SOLANA_FEE_PAYER`/`PAYAI_FEE_PAYER` → 直近観測 `2wKupLR9q6…` のハードコード）で **402は必ず返す**。骨格(scheme/network/asset/payTo/金額)は静的のまま。payTo は実行時env解決＋本人ウォレットfallbackで空にしない。**既存関数（`buildRouteConfig`/`buildSolanaOnlyRouteConfig`/facilitator配線/Base定数）は無変更。**
  - **これは facilitator依存の復活ではない**: 依存は「鮮度が必要な feePayer 1フィールド」に限定。leg の型・version選択は自前のまま。取得失敗しても fallback で 402 が出る（空402にならない）。
- `lib/x402-route.ts`: `withSolanaOnlyPaywall` を書き換え。
  - OPTIONS → CORS 204
  - internal-key → 素通し（無料）
  - **X-PAYMENT / payment-signature あり → 従来の `withX402AndInternal`（@x402/svm+PayAI verify/settle）に委譲**（決済ロジック不変）
  - **未払い → 自前構築の402**（`{x402Version:1, accepts:[v1 leg, v2 leg], error}`、facilitator非依存）
  - `withPaywall`（Base dualLeg）・`withX402AndInternal` は無変更＝**Base回帰なし**（diff で確認）
- `scripts/__tests__/solana-paywall.test.mjs`: dual-leg アサーション追加（v1先頭/v2併記、network・amount系フィールド・extra.feePayer・atomic換算）。

### 出力する402（両leg・実出力）
```json
{
  "x402Version": 1,
  "accepts": [
    { "scheme": "exact", "network": "solana",
      "maxAmountRequired": "10000",
      "resource": "https://osd-coral.vercel.app/api/ipo", "description": "...",
      "mimeType": "application/json", "payTo": "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf",
      "maxTimeoutSeconds": 300, "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "feePayer": "<env X402_SOLANA_FEE_PAYER>", "resource": "https://osd-coral.vercel.app/api/ipo" } },
    { "scheme": "exact", "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "maxAmountRequired": "10000", "amount": "10000",
      "resource": "...", "description": "...", "mimeType": "application/json",
      "payTo": "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf", "maxTimeoutSeconds": 300,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "feePayer": "<env>", "resource": "..." } }
  ],
  "error": "X-PAYMENT header is required"
}
```
（holders/liquidity も resource/description 以外同型。3ルート分の生出力を実機で採取済み。）

### ローカル検証（実施済み・グリーン）
- `npx tsc --noEmit`: exit 0
- `npm test`: **64/64 pass**（solana-paywall に dual-leg ＋ feePayer解決 のアサーション追加）
- 3エンドポイントの生402実出力: 全て上記 dual-leg（v1先頭・v2併記）。未払い経路は **facilitator を一切叩かない**ことも実行ログで確認（printは完走し、その後の background init だけが sandbox egress 403 で落ちる＝本番では allowlist 済み）。
- Base（`withPaywall` / EVM）は diff 上で無変更を確認。

---

## 5. v1/v2 両leg設計の根拠（§3で確定済み）

- AAは **v1**（`maxAmountRequired`、network alias `"solana"` → mainnet CAIP-2 正規化）。→ 先頭 v1 leg にマッチ。
- v2 native client は **`amount` / CAIP-2**。→ 2本目 v2 leg にマッチ。
- 両legとも同一の price/payTo/asset/feePayer。plain `z.object`（strip）なので相互のフィールド混在は安全（§3-4）。
- **body top-level は `x402Version:1` 固定。** 完全な v2 transport（`x402Version:2` body ＋ PAYMENT-REQUIRED base64 ヘッダ）は @x402/core だけでは合成しきれない（本番実測の v2 base64 が必要）→ **別トラック**。現状は「body accepts への v2 併記」まで。

### 【次改修候補・記録】v2 legを"本当に届ける"にはヘッダーにも載せる
自前402は **body（v1 transport）** で返している。純粋な v2 クライアントは **`PAYMENT-REQUIRED` ヘッダー**（base64）を読むため、body に v2 leg を併記しても v2-native クライアントには**見えない可能性がある**。
- 現行AA（v1経路で body を読む）には影響なし → **今回の pay→200 のブロッカーではない**。
- 「v2 leg を本当に v2 クライアントへ届ける」なら、`PAYMENT-REQUIRED` ヘッダーにも v2 PaymentRequired（base64）を載せる改修が必要。実装には本番実測の v2 base64 リファレンスが要る（§5 別トラックと同根）。**次の改修候補として記録。**

---

## 6. 残タスク（優先順・担当）

| # | 内容 | 担当 | ブロッカー |
|---|---|---|---|
| 1 | **`X402_SOLANA_FEE_PAYER=2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4` を Vercel env に設定**（**fallback用**、必須値源ではない）。本番では `getSolanaFeePayer()` が毎回 facilitator から鮮度取得するので通常はこの env は使われない。facilitator到達不能時の last-known-good として機能。※feePayerはローテーションするので env は「腐ってもよい保険」。 | 運用者 | — |
| 2 | **本番デプロイ判断**（work branch → main マージ or Vercel deploy）。**本エージェントは production へ勝手に merge しない**。 | 運用者 | — |
| 3 | デプロイ後 AAで pay→200→**solscanでbase58 tx着金確認**（payTo `4s8XQC…` へ0.01 USDC）。Solana決済であること(base58/0xでない)も確認。あわせて **自前v1チャレンジ→withX402委譲settle の突き合わせ**（client が payload に載せる network `"solana"` と、委譲先 withX402 の verify マッチ）を実機で確認 | 運用者 | AA署名ウォレットのUSDC残高補充（PayAI feePayerのためSOL不要、USDCのみ数ドル） |
| 4 | 本番実402との最終照合: `curl -i https://osd-coral.vercel.app/api/ipo`（＋Base `/api/stocks`）で外形採取・突き合わせ | 運用者 | sandboxはegress制限で本番到達不可 |
| 5 | JIN Movers 用リファレンス402の記録（pay→200成立時の実402構造） | 運用者/担当 | ③成立後 |

---

## 7. 絶対制約（この作業で守っていること）

1. 決済の署名・settleロジックは自前化しない（@x402/svm+PayAIに委譲）。自前化したのは **acceptsの組み立てのみ**。
2. Base側（EVM/Circle、withPaywall dualLeg）に触らない（diffで確認）。
3. LIVE認証情報に触れない・出力しない。
4. 型を推測で埋めない。**@x402/svm / @x402/core 2.13.0 実物のみを根拠**（v2の `amount` は `PaymentRequirementsV2Schema` 実物、v1の `maxAmountRequired`/`"solana"` は svm/v1 実物）。
5. v1 leg を壊さない（現行AAの決済生命線）＝先頭 v1 leg + body x402Version:1 固定。
6. src修正・ローカル402だけでは未完了。運用者の pay→200・base58 tx着金確認までが完了。
7. 勝手に production へ merge しない。デプロイ判断は運用者。

---

## 8. 主要参照（コード位置）

- OSD: `lib/x402.ts`（定数・facilitator配線・自前ビルダー `buildSolanaAcceptsV1`）、`lib/x402-route.ts`（`withSolanaOnlyPaywall` / `withPaywall` / `withX402AndInternal`）、`app/api/{ipo,holders,liquidity}/route.ts`、`app/.well-known/x402.json/route.ts`（discovery記述子＝別途 self-built）。
- パッケージ実型（2.13.0）:
  - `@x402/svm/dist/esm/exact/server/index.mjs`（`register("solana:*")`）
  - `@x402/svm/dist/cjs/v1/index.js`（`V1_TO_V2_NETWORK_MAP`, `normalizeNetwork`, `ExactSvmSchemeV1` → `maxAmountRequired`）
  - `@x402/svm/dist/esm/exact/client`（v2 → `amount`）
  - `@x402/core/dist/cjs/schemas/index.(js|d.ts)`（`PaymentRequirementsV1Schema` / `PaymentRequirementsV2Schema`）
  - `@x402/next/dist/esm/index.js`（`withX402` / `handlePaymentError`）
- バージョン: `@x402/core` `@x402/next` `@x402/svm` `@x402/evm` = **2.13.0**。

---

## 9. 環境メモ（作業者向け注意）

- このサンドボックスは **bash複数行出力・Read・ファイル書き込みが時々壊れる**。git系は `… > scratchpadファイル` にリダイレクトして Read すると確実。壊れたら採り直す。
- 本番(osd-coral.vercel.app)・facilitator(payai.network / cdp.coinbase.com) へは **egress allowlist で到達不可**（403）。本番curl・PayAI疎通は運用者側で。
- `data/*.json`（portfolio/performance/catalysts）は cron 自動更新。コード変更の commit には含めない。
- ローカルの未push作業は環境リセットで消えるこ​とがある（過去 `a6f8f9e`/`e3a7f9c` が GC された）。**確定したら即 push すること。**
