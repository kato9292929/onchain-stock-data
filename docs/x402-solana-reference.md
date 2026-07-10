# Solana x402 対応 — 正典リファレンス（OSD = コピー元）

作成: 2026-07-10 ／ 対象: OSD 本番実装（PR #15）を正として、他プロダクト（JIN 等）を同型化するための仕様。

> このドキュメントは**移植のコピー元仕様**。OSD の実コード（`lib/x402.ts` / `lib/x402-route.ts`）が唯一の正。
> ここに書いた形と OSD 実コードがズレたら**実コードが正**。推測で足さない。

---

## 0. 一番大事な結論（これだけは外さない）

1. **transport は「body の `accepts[]` に v1 leg と v2 leg を併記」**。v1 leg を先頭にする。
   **v2 を `PAYMENT-REQUIRED` レスポンスヘッダ（base64(JSON)）に載せる独自方式は使わない。**
   理由: OSD は body 併記で本番稼働・curl実測済み。ヘッダ方式は実AAで通る保証がなく、二系統を保守する意味がない。
2. **body top-level は `x402Version: 1` 固定。**
3. **verify/settle は自前実装しない。** `@x402/next` の `withX402` に委譲する。
   自前化してよいのは **①402チャレンジ（accepts）の組み立て と ②feePayer の取得** の2つだけ。
4. **feePayer はハードコード・env固定にしない。** facilitator から動的取得（ローテーションするため）。4段 fallback で 402 は必ず返す。
5. 「pay→200 完了」は、実AA（`6JKVug…`）の実払いで 200 が返り、solscan で payTo（`4s8XQC…`）への 0.01 USDC 着金（base58 tx, Success）を確認するまで**書かない**。ローカルテスト緑は完了ではない。

---

## 1. 402 body の正確な形（実出力・コピペ可）

未払い（`X-PAYMENT` なし）のとき、各エンドポイントが返す 402 body:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "10000",
      "resource": "https://<host>/api/<path>",
      "description": "<endpoint description (Latin-1のみ)>",
      "mimeType": "application/json",
      "payTo": "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf",
      "maxTimeoutSeconds": 300,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "feePayer": "<facilitatorから動的取得>", "resource": "https://<host>/api/<path>" }
    },
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "maxAmountRequired": "10000",
      "amount": "10000",
      "resource": "https://<host>/api/<path>",
      "description": "<同上>",
      "mimeType": "application/json",
      "payTo": "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf",
      "maxTimeoutSeconds": 300,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "feePayer": "<同じ値>", "resource": "https://<host>/api/<path>" }
    }
  ],
  "error": "X-PAYMENT header is required"
}
```

ポイント:
- **2本の leg は `network` と、v2側の `amount` 追加以外は同一。** 両方に `maxAmountRequired` を載せる（v1本体schemaを満たしつつ v2は `amount` を読む）。
- **v1 leg が先頭。**
- `extra.feePayer` は **両 leg 必須**（無いと svm client が `"feePayer is required"` で throw）。

---

## 2. なぜこの形か（フィールド一次ソース根拠）

`@x402/core` / `@x402/svm` の**実 dist コード**で確認したもの。バージョンは各自の install 版の `dist/` を `npm pack` で確認すること（OSD は 2.13.0 で確認。フィールド分割は 2.1x 系で共通）。

| 項目 | v1 leg | v2 leg | 根拠（実コード） |
|---|---|---|---|
| body `x402Version` | `1`（top-level 固定） | 同 | `@x402/core` `schemas` `PaymentRequiredV1Schema` |
| `network` | `"solana"`（bare alias） | `"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"`（CAIP-2） | `@x402/svm/.../v1` `V1_TO_V2_NETWORK_MAP`/`normalizeNetwork`（bare→mainnet CAIP-2） ／ v2 は `NetworkSchemaV2`（":"必須） |
| 金額フィールド | `maxAmountRequired` | `amount`（＋ `maxAmountRequired` も残す） | v1: `ExactSvmSchemeV1` が `BigInt(selectedV1.maxAmountRequired)` ／ v2: `@x402/core` `PaymentRequirementsV2Schema` `amount`, `@x402/svm` exact/client が `BigInt(paymentRequirements.amount)` |
| `extra.feePayer` | 必須 | 必須 | 両 svm client が `extra.feePayer` を読む。無いと throw |
| scheme/asset/payTo/maxTimeoutSeconds | 共通 | 共通 | — |

**両legに余分キーを載せてよい理由:** `PaymentRequirementsV1Schema`・`PaymentRequirementsV2Schema` はどちらも plain `z.object`（`.strict()` でない）→ 未知キーは **reject でなく strip**。だから v1 leg に `amount` を、v2 leg に v1一式（resource/description等）を載せても安全。各 client は自分の知るフィールドだけ読む。

確定値（全プロダクト共通）:
- Solana mainnet CAIP-2: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
- Solana USDC mint（asset）: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- payTo: `4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf`
- 金額: 0.01 USDC = atomic `"10000"`（USDC 6桁）

---

## 3. feePayer 動的取得（4段 fallback）— 固定禁止

**feePayer は同日内でローテーションする**（2026-07-09 実測: `D6ZhtNQ5nT…` → `BFK9TLC3…` → `2wKupLR9q6…`）。固定すると回転した瞬間に古い名義を tx に焼き込み、PayAI が署名を完成できず **settle 不能**（「気づいたら壊れてた」の正体）。

OSD `getSolanaFeePayer()` のロジック（`lib/x402.ts`）:

1. **3分TTLのメモリキャッシュが生きていればそれを返す。**
2. 無ければ **`payaiFacilitatorClient.getSupported()` を叩き**、`kinds[]` の中で `network` が `solana` で始まり `extra.feePayer` が文字列のものを採用。成功したらキャッシュ（now+3分）して返す。
3. 取得失敗（403/timeout/形状ドリフト）→ **直前のキャッシュ**があればそれ（stale-but-known）。
4. それも無ければ **env（`X402_SOLANA_FEE_PAYER` → `PAYAI_FEE_PAYER`）→ ハードコード last-known-good（`2wKupLR9q6…`）**。

→ **どの経路でも feePayer は非空。402 は必ず返る（空402にならない）。**

`getSupported()` の戻り形状（`@x402/core` http 実測）:
```
{ kinds: [ { x402Version:number, scheme:string, network:string, extra?:Record } ], extensions:string[], signers:Record }
```
solana の `kind.extra.feePayer` を採る。

**これは facilitator依存の復活ではない。** 依存は「鮮度が要る feePayer 1フィールド」に限定。leg の骨格（scheme/network/asset/payTo/金額）と version 選択は自前のまま。取得に失敗しても fallback で 402 が出る。

> ⚠️ 旧 regression の原因は「`withX402` が facilitator の `getSupported()` から **accepts全体を組んでいた**」こと。PayAI が v2 kind を足した瞬間 accepts が v2化して v1 AA とミスマッチした。**accepts の組み立てを facilitator に任せてはいけない。** 骨格は自前、feePayer だけ facilitator、が正解。

---

## 4. ルーティング（`withSolanaOnlyPaywall` の分岐）

`lib/x402-route.ts`。1リクエストの処理順:

1. `OPTIONS` → 204 + CORS（`withX402` に触れない）。
2. `X-Internal-Key` 一致 → handler 直行（無料）。
3. **`X-PAYMENT` または `payment-signature` あり → `withX402`（=@x402/svm+PayAI の verify/settle）に委譲**。決済ロジックは無変更。
4. **未払い → 自前構築の402**（§1 の body、feePayer は §3 で解決）を返す。

CORS: `Access-Control-Expose-Headers` に `PAYMENT-REQUIRED, PAYMENT-RESPONSE`（大小両方）。`Access-Control-Allow-Headers` に `X-PAYMENT, Content-Type, X-Internal-Key`。

---

## 5. discovery（`/.well-known/x402.json`）の扱い — 注意

**OSD の discovery は現状、本体402と同型ではない。** discovery の Solana leg は **単一の v2形 leg**（CAIP-2 / `amount` のみ、`feePayer` なし、descriptor `version:2`）。これは **directory crawler（x402scan/Pay.sh）向けメタデータ**で、**AA が settle に使うのは本体402（エンドポイントを叩いて返る402）であって discovery ではない**。

したがって:
- **pay→200 に効くのは §1 の本体402。JIN は本体402を最優先で一致させる。**
- discovery は「壊れてはいないが、本体402と厳密一致していない」状態。JIN側で discovery を作るなら、混乱を避けるため本体402の2 leg（v1+v2）に揃えるのが望ましい（OSD側も将来揃える改善余地として記録）。
- **移植チェックの diff 対象は「本体402の JSON」**。discovery JSON を本体402と厳密 diff しない（別物なので差分が出て当然）。

---

## 6. JIN で差し替える値だけ（それ以外はOSDと同一に）

- `resource` URL / `description` / `mimeType` … JIN の endpoint 情報。
- **`description` に非 Latin-1 文字（em-dash `—`、`×` 等）を入れない。** OSD の一部 description には `×`/`—` が入っているが、JIN 側は Latin-1 安全な文字に寄せる（ヘッダ/エンコード事故回避）。
- `amount` / `maxAmountRequired`: `"10000"`（0.01 USDC）。
- payTo・asset・CAIP-2・facilitator URL は**共通値（§2）をそのまま**。差し替えない。

env（Vercel）:
- `X402_SOLANA_FEE_PAYER=2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`（**fallback用**。通常は動的取得が使われる）
- facilitator URL: `https://facilitator.payai.network`
- Production Branch が `main` に設定されていることを確認（反映遅延の前例あり）。

---

## 7. `filtered out by policies for x402 version: 1` の切り分け（未確定・推測で埋めない）

JIN で観測されたこのエラーは **AA/クライアント側**の可能性が高い（`registerExactSvmScheme` の登録内容 or `x402Client` の policy が v1 を弾いている）。パッケージ層は v1 `"solana"` を受理する（実コード確認済み）。

方針:
- **body に v1 + v2 を併記していれば、v1 を policy で弾く AA でも v2 leg を掴める**（X-alpha で実AAが v2 leg を掴み部分署名・送信まで到達した観測あり）。まずは §1 の型で pay→200 を実測。
- それでも通らない場合、**AA リポの `registerExactSvmScheme` 登録と `x402Client` policy の実コードを読む**まで真因を断定しない。
- verify が絡む段では **verify応答の `invalidReason` を最初に見る**。

---

## 8. 受け入れ条件（この順で確認）

1. 本番の**本体402**（`curl -i https://<jin-host>/<paid-path>`）が §1 の構造（v1先頭+v2併記、`x402Version:1`、両leg `extra.feePayer` 入り）であること。OSD 本体402と JIN 固有値以外差分なし。
2. env / Production Branch（§6）。
3. 実AA（`6JKVug…`）で **pay→200** → solscan で payTo（`4s8XQC…`）への 0.01 USDC **着金（base58 tx, Success）**。← ここで初めて「pay→200 完了」。
4. 一発で通らないときは verify応答 `invalidReason` を最初に見る。

---

## 9. 参照（OSD 実コード位置）

- `lib/x402.ts`: `buildSolanaAcceptsV1`（402 accepts 組み立て）、`getSolanaFeePayer`/`solanaFeePayerFallback`（feePayer 動的取得＋fallback）、定数（CAIP-2/asset/payTo）。
- `lib/x402-route.ts`: `withSolanaOnlyPaywall`（ルーティング分岐）、CORS。
- `app/api/{ipo,holders,liquidity}/route.ts`: 呼び出し例（price `$0.01`、resourcePath、OPTIONS）。
- `app/.well-known/x402.json/route.ts`: discovery（§5 の注意つき）。
- パッケージ実型: `@x402/svm` `dist/cjs/v1/`（v1: maxAmountRequired/"solana"）・`dist/*/exact/client`（v2: amount）・`dist/*/exact/server`（`register("solana:*")`）、`@x402/core` `dist/*/schemas`（`PaymentRequirements V1/V2 Schema`）、`@x402/next` `dist/*/index`（`withX402`/`handlePaymentError`）。
- 詳細な調査経緯: `docs/x402-solana-empty-402-status.md`。
