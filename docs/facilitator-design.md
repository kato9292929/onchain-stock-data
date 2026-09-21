# Facilitator design (seller side)

osd は x402 の**売り手**（resource server）なので、どの facilitator に verify/settle を委ねるかはこのリポジトリが決めます。本書は現状の配線、障害時の振る舞い、そして Circle facilitator を採用しなかった理由の記録です。

## 1. 現状の配線 (`lib/x402.ts`)

| ネットワーク | facilitator | 認証 | 使っているルート |
|---|---|---|---|
| Base mainnet (`eip155:8453`) | CDP (`@coinbase/x402`) | `CDP_API_KEY_ID`/`SECRET` → `FACILITATOR_URL` → 匿名 CDP | `/api/alpha/...` の Base leg |
| Solana mainnet | PayAI (`@payai/facilitator`) | 無料 tier はキー不要 | `/api/alpha/...` の Solana leg、`/api/catalyst/:ticker`・`/api/edinet/:code`（**Solana 単 leg**） |
| Base Sepolia (`eip155:84532`) | `https://x402.org/facilitator` | 不要 | `/api/testnet/signal`（デモ専用・別インスタンス） |

`x402ResourceServer` には **CDP を先頭、PayAI を 2 番目**の配列で渡し、SDK が `getSupported()` のマップでネットワークごとに振り分けます。PayAI client の構築に失敗した場合は `[CDP]` のみに degrade します（Base の経路は不変）。

## 2. 障害時の振る舞い — 「片方が死ぬと両方死ぬ」問題と対処

SDK の挙動を読んだ結果、**facilitator 1 つの停止が、健全なチェーンまで巻き添えにする**ことが分かりました。

- `x402ResourceServer.initialize()` は facilitator ごとの `getSupported()` 失敗を catch し、**全滅したときだけ** throw します（`@x402/core/dist/esm/server/index.mjs:488-500`）。ここまでは意図どおり。
- しかし `buildPaymentRequirements()` は、supported kinds が読めなかったネットワークに対して **throw** します（同 `:560-564`）。そして accepts を回すループはこれを catch しません（同 `:604-621`）。

結果として、**CDP が落ちる／キーが失効する／枠を使い切ると、dual-leg の `/api/alpha/...` は未署名リクエストごとに 500** になります。Solana 側が PayAI で正常に決済できていてもです。Solana 単 leg の per-call（`/api/catalyst/:ticker`・`/api/edinet/:code`）だけが生き残ります。

**対処（実装済み・`lib/x402-route.ts`）**: facilitator 起因の失敗を検出したら、`verifiableAccepts()` で**今まさに verify 可能な leg だけ**に絞って 402 を組み直します。

- 一部の leg が生きている → **劣化した 402**（生きているチェーンのみ提示）。価格は不変。
- どの leg も verify できない → **503 + `Retry-After: 60`**（`payment_unavailable`）。500 でもなければ、無料の 200 でもありません。

`scripts/__tests__/facilitator-degradation.test.mjs` が、実 SDK ＋ モック facilitator でこの挙動を固定しています（Base 停止時に Solana 単 leg の 402 が返ること、全滅時に 503 が返ることを含む）。**最初のテストはあえて「SDK が throw すること」を assert** しており、将来 SDK 側がスキップ挙動に変われば落ちて気付けます。

## 3. Circle facilitator の評価 (2026-09) — 現時点では採用しない

### 調べたこと

- **対応ネットワークは Arc / Base / Polygon PoS**、EIP-3009 の exact scheme 経由。**Solana は対象外**（2026-09-16 の Arc mainnet 公開と同時にローンチ）。
- **料金は onchain settle が月 1,000 件まで無料、超過は 1 件 $0.001。verify は常時無料。**
- 売り手は verify/settle/status の各呼び出しを **`Facilitator-Seller-Proof`（`payTo` に紐づく EIP-712 の売り手署名）**で認証する。エンドポイントは `POST /v1/x402/settle`、`GET /v1/x402/transfers/:id` の形。

### 結論: 今の osd には入れない。理由は3つ。

1. **売上の主軸である per-call が1本も移せない。** `/api/catalyst/:ticker`・`/api/edinet/:code` は `assertSolanaExactUsdc` が「Solana の accept ちょうど1本」を起動時に強制しており（ドリフトすれば fail closed で 500）、Solana 非対応の facilitator では 1 コールも捌けません。移せる可能性があるのは `/api/alpha/...` 7 本の **Base leg だけ**です。
2. **ドロップイン置換ではない。** osd は `HTTPFacilitatorClient({ url })` で標準の facilitator wire format（`/verify`・`/settle`・`/supported`）を話します。Circle は URL 形状が異なるうえ EIP-712 の seller proof を要求するため、**アダプタの自作が必要**です。公式の npm パッケージは存在しません（`@coinbase/x402`・`@payai/facilitator` に相当するものが無い）。`FACILITATOR_URL` に URL を入れるだけでは動きません。
3. **無料枠の壁は同じ位置。** 月 1,000 件で $0.001/件 という条件は CDP と同じです。枠が理由で移すなら、移した先で同じ月に同じように止まります。

### 再評価すべき条件

- osd が **Arc / Polygon PoS** に販売面を広げるとき（CDP でカバーされない先が出る）。
- **Base の冗長化**を本気でやるとき。上記 §2 の劣化対応で「Base が死んでも Solana で売り続ける」ところまでは担保しましたが、**Base leg 自体の二重化**（CDP が死んだら別 facilitator で Base を検証する）は未対応です。SDK は配列の先頭優先でネットワークごとに 1 client を選ぶため、同一ネットワークのフェイルオーバーは自前で書く必要があります。
- Circle が Solana に対応したとき。この場合は per-call も選択肢に入るので、結論が変わります。

### 検証の限界（断定していない点）

このサンドボックスからは `docs.x402.org`・`circle.com`・`cryptobriefing.com` いずれも egress プロキシにブロックされており、**一次ページを直接読めていません**。上記の事実は Web 検索経由の要約を突き合わせたもので、**本番の facilitator URL は未確認**です（テストネットは `https://gateway-api-testnet.circle.com` とされる）。実装に進む場合は、Circle の公式ドキュメントを直接確認してから着手してください。

Sources:
- [Circle's x402 Facilitator Service goes live on Arc, supports Base and Polygon PoS](https://cryptobriefing.com/circle-x402-facilitator-service-arc-launch/)
- [Monetize Your API for AI Agents with x402 and USDC | Circle](https://www.circle.com/blog/turn-your-api-into-a-storefront-for-agents)
- [What is x402? - Circle Docs](https://developers.circle.com/gateway/nanopayments/concepts/x402)
- [Networks & Token Support - x402](https://docs.x402.org/core-concepts/network-and-token-support)
