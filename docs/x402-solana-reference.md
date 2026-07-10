# Solana x402 対応 — 402 ワイヤ形式リファレンス（＋確定した真ブロッカー）

作成: 2026-07-10 ／ 対象: 402 の**ワイヤ形式仕様**（サーバー側）と、Solana決済が通らない**真因の確定記録**。

> このドキュメントは 402 の**形の仕様**であって「これをコピーすれば Solana が通る」という保証書ではない。
> OSD の実コード（`lib/x402.ts` / `lib/x402-route.ts`）が形の唯一の正。推測で足さない。

---

## ⚠️ 最重要の訂正（2026-07-10 daily ラン実測）

**OSD Solana は本番で1本も通っていない。** 2026-07-09 の daily ランで、OSD の `/api/ipo`・`/api/holders`・`/api/liquidity`（Solana）は**全滅**。エラーは
`Failed to create payment payload: All payment requirements were filtered out by policies for x402 version: 1`、**HTTP 0 / ref=-（送信すらしていない）**。
毎日通っている ref付き200 は `eip155:8453`（Base/EVM）**だけ**。→ **OSD Solana は「動くコピー元」ではない。**

**真因（`@x402/core` クライアント実コードで確定）:** AAクライアントの **`x402Client` に登録された policy** が Solana requirements を payload構築前に全フィルタしている（`client/index.js:412`）。**scheme登録・network文字列・サーバー402の形は無罪**（それらは別のエラー行を投げるが、今回は投げていない）。詳細は §7。

**帰結:** サーバー側（OSD/JIN）の402をどう変えても直らない。**まず AA 側の policy を直す**（§7 の順序）。下の 1〜6 は「AA が Solana を受け付けるようになった後」に 402 の形を揃えるための仕様として読むこと。

---

## 0. 一番大事な結論（これだけは外さない）

1. **transport は「body の `accepts[]` に v1 leg と v2 leg を併記」**。v1 leg を先頭にする。
   **v2 を `PAYMENT-REQUIRED` レスポンスヘッダ（base64(JSON)）に載せる独自方式は使わない。**
   理由: OSD の 402 body 形は curl で**形状のみ実測済み**（＝この形が出ることは確認済み。ただし §上部の訂正どおり、この形で pay→200 が通ったわけではない）。ヘッダ方式は実AAで通る保証がなく、二系統を保守する意味もない。まず AA policy を直す前提で、形はこの body 併記に統一する。
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

## 7. 真ブロッカー: `filtered out by policies for x402 version: 1`（AA policy で確定）

**これがSolanaが通らない真因。** サーバー402の形の問題ではない。エラーは `@x402/core` クライアント `selectPaymentRequirements`（`client/index.js`）が出す。3段階のどこで落ちたかで原因が特定できる:

| 段階 | コード | ゼロになったときのエラー |
|---|---|---|
| 1. version登録 | L388-390 | `No client registered for x402 version: X` |
| 2. network/scheme フィルタ | L392-407 | `No network/scheme registered for x402 version: X which comply...`（acceptsと登録内容をJSONダンプ） |
| 3. **policy 適用** | L409-413 | **`All payment requirements were filtered out by policies for x402 version: X`** ← 実際に出ているのはこれ |

**出ているのは L412（policy段階）**なので、確定として:
- ✅ 段階1通過 → AAは v1 用に Solana scheme を登録済み（`registerV1`）。
- ✅ 段階2通過 → Solana leg（`network:"solana"`, `scheme:"exact"`）は登録に**マッチしている**。**network文字列・scheme登録・サーバー402の形は無罪**（問題なら L390/L400 の別エラーになる）。
- ❌ 段階3 → AAに登録された **`x402Client` policy が Solana requirements を全部フィルタで落としている**。

物証: `@x402/core` のpolicyサンプル（`client/index.js:146-148`）に
`client.registerPolicy((version, reqs) => reqs.filter(r => r.network.startsWith('eip155:')))` がある。これがあれば Solana は `eip155:` で始まらず全落ち → L412。**Base(EVM)だけ毎日通る**のと完全整合。

**候補policy（AAリポを読むまで断定しない）:**
- (a) **network許可リスト**（`eip155:` のみ許可）→ Solanaを常に落とす。version非依存。
- (b) **version固定**（`version === 2` のみ許可）→ x402Version:1 の body を丸ごと落とす。

**サーバー側（OSD/JIN）でこれは直せない。** AAが payload構築前に落としているので accepts の形は無関係。

（行番号はビルドで前後する: 本レポ node_modules の cjs は policy ループ L409-413/throw L412。別ビルド(mjs/src)では L436-441 等。**ロジックは同一**。3者が独立に同じ結論。）

### X-alpha「v2到達」矛盾の解消（同じ誤読の再発防止）
「手動テストでは実AAが v2 leg を掴んで部分署名・送信まで到達した」という観測と、本番 daily の全滅は**矛盾しない**。理由が実コードで閉じた:
- 手動 `test-payment-solana.js` は**最小クライアント**で `registerPolicy` を呼ばない → `this.policies` が**空** → policyループを素通り → v2 leg を掴めた。
- 本番AAは `fromConfig` / `initX402Fetch` で **policy を積む** → 同じウォレット・同じサーバー・同じ402でも policy段（L412）で死ぬ。
- → **「手動 test-payment が通った」を「本番AAが通る」と読み替えてはいけない。** policy構成が別物。前回の「X-alphaでv2到達したから OSDの v2 leg は本番で通る」という増幅は、この違いを見落としたことによる。

### やるべき順序（サーバー先行は無意味・AA先行）
1. **AAリポの実コードを読む**: `grep -rn "registerPolicy\|fromConfig\|policies\|startsWith('eip155\|x402Version === 2\|\.filter(" src/ dist/`。`x402Client.fromConfig({ policies:[…] })` / `registerPolicy(…)` の predicate を特定し、上記 (a)/(b) を確定。
2. **AA policy を修正** → Solana leg を残す（EVMと同じく「1本でも通る」状態に）。verify段では応答 `invalidReason` を最初に見る。
3. そのあと初めて、JIN / OSD の 402 を §1 の形に揃える（→ pay→200 実測）。

---

## 8. 受け入れ条件（この順で確認）

0. **（前提）AA policy が Solana leg を通す**ようになっていること（§7）。ここが未達なら以下は全て無意味。
1. 本番の**本体402**（`curl -i https://<host>/<paid-path>`）が §1 の構造（v1先頭+v2併記、`x402Version:1`、両leg `extra.feePayer` 入り）であること。
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
