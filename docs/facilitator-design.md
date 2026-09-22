# Facilitator design (seller side)

osd は x402 の**売り手**（resource server）なので、どの facilitator に verify/settle を委ねるかはこのリポジトリが決めます。本書は現状の配線、障害時の振る舞い、そして Circle facilitator を採用しなかった理由の記録です。

## 1. 現状の配線 (`lib/x402.ts`)

| ネットワーク | facilitator | 認証 | 使っているルート |
|---|---|---|---|
| Base mainnet (`eip155:8453`) | CDP (`@coinbase/x402`) | `CDP_API_KEY_ID`/`SECRET` → `FACILITATOR_URL` → 匿名 CDP | **なし**（§4 で提示をやめた。配線のみ残置） |
| Solana mainnet | PayAI (`@payai/facilitator`) | 無料 tier はキー不要 | `/api/alpha/...` の Solana leg、`/api/catalyst/:ticker`・`/api/edinet/:code`（**Solana 単 leg**） |
| Base Sepolia (`eip155:84532`) | `https://x402.org/facilitator` | 不要 | `/api/testnet/signal`（デモ専用・別インスタンス） |

`x402ResourceServer` には **CDP を先頭、PayAI を 2 番目**の配列で渡し、SDK が `getSupported()` のマップでネットワークごとに振り分けます。PayAI client の構築に失敗した場合は `[CDP]` のみに degrade します（Base の経路は不変）。

## 2. 障害時の振る舞い — 「片方が死ぬと両方死ぬ」問題と対処

SDK の挙動を読んだ結果、**facilitator 1 つの停止が、健全なチェーンまで巻き添えにする**ことが分かりました。

- `x402ResourceServer.initialize()` は facilitator ごとの `getSupported()` 失敗を catch し、**全滅したときだけ** throw します（`@x402/core/dist/esm/server/index.mjs:488-500`）。ここまでは意図どおり。
- しかし `buildPaymentRequirements()` は、supported kinds が読めなかったネットワークに対して **throw** します（同 `:560-564`）。そして accepts を回すループはこれを catch しません（同 `:604-621`）。

結果として、**CDP が落ちる／キーが失効する／枠を使い切ると、dual-leg の `/api/alpha/...` は未署名リクエストごとに 500** になります。Solana 側が PayAI で正常に決済できていてもです。Solana 単 leg の per-call（`/api/catalyst/:ticker`・`/api/edinet/:code`）だけが生き残ります。

（§4 で Base leg の提示をやめたため、**この巻き添えパターンは現在は発生しません**。劣化ロジックは残しています — PayAI 単独になった今、facilitator 全滅時に 500 ではなく 503 を返す経路として効きます。また Base を戻した瞬間に巻き添えが復活するのを防ぎます。）

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
- **Base を売り面に戻すとき**（§4）。その場合、**Base leg 自体の二重化**（CDP が死んだら別 facilitator で Base を検証する）は依然として未対応です。SDK は配列の先頭優先でネットワークごとに 1 client を選ぶため、同一ネットワークのフェイルオーバーは自前で書く必要があります。
- Circle が Solana に対応したとき。この場合は per-call も選択肢に入るので、結論が変わります。

### 検証の限界（断定していない点）

このサンドボックスからは `docs.x402.org`・`circle.com`・`cryptobriefing.com` いずれも egress プロキシにブロックされており、**一次ページを直接読めていません**。上記の事実は Web 検索経由の要約を突き合わせたもので、**本番の facilitator URL は未確認**です（テストネットは `https://gateway-api-testnet.circle.com` とされる）。実装に進む場合は、Circle の公式ドキュメントを直接確認してから着手してください。

## 4. 決定 (2026-09): 本番の有料面は Solana 一本

`/api/alpha/...` 7 本の Base leg を外し、**本番で課金するエンドポイントはすべて Solana USDC の単 leg** に統一しました（`withPaywall` → `withSolanaOnlyPaywall`、記述子の `dualLegs` → `solanaOnlyLeg`）。

### 理由

1. **このリポジトリ同梱の買い手は Solana でしか払えない。** `scripts/x402-weekly-buyer.mjs` は `@solana/kit` と `AA_SOLANA_SECRET_KEY` だけで署名します（同 `:72-75`、GitHub Actions の secret も同じ）。

   > **訂正 (2026-09-22)**: 当初この理由を「AA は EVM の署名手段を持っていない」と書きましたが、**これは誤りです**。検証したのは上記の同梱スクリプトだけで、それを外部の買い手 AA に一般化していました。AA 本体は別リポジトリにあり、買い手側セッションの報告によれば **`SIGNER_BACKEND=circle` + `CIRCLE_EVM_WALLET_ID` による EVM 署名手段を持ち、Base 残高（約 14.18 USDC）もあり、現状 Base で支払可能**とのことです（当方はそのリポジトリを見ておらず未検証）。
   >
   > したがって **Base leg は「誰も使えない leg」ではありませんでした**。この決定は下の 2・3 に依拠します。1 は「同梱 buyer は Solana 専用」という限定的な事実に留めてください。

   > **追補 (2026-09-22) — Base leg は「使われない」どころか「必ず選ばれて必ず落ちる」leg でした。**
   >
   > `@x402/core` のクライアント既定セレクタは `(x402Version, accepts) => accepts[0]`（`node_modules/@x402/core/dist/esm/client/index.mjs:31`）で、**買い手は「自分が決済できるチェーン」を選びません。売り手が先頭に並べた leg をそのまま払います。** そして `buildRouteConfig` は **Base を先頭**に置いていました。
   >
   > 買い手側セッションの報告によれば、AA は独自セレクタを渡していないため **dual-leg の osd では常に Base を選択**しており、CDP がブロックされた状態で「署名 → settle 失敗 → 中身が空の 402」という形で落ちていました（ログ上は `[CALLER:solana]` と出ていたため切り分けが遅れた、とのこと）。当方で検証できるのは上記のセレクタ実装と leg 順序までで、AA 側のログは未確認です。
   >
   > つまり Solana 一本化は単なる簡素化ではなく、**実際に壊れていた経路の修正**でした。あわせて `buildRouteConfig` の leg 順を **Solana 先頭**に変更し、`scripts/__tests__/solana-paywall.test.mjs` で `accepts[0]` が Solana であることを固定しています（Base を戻す日に同じ罠を踏まないため）。
2. **払えない leg の提示は、提示しないより悪い。** §2 の劣化対応がカバーするのは `getSupported()` が読めない**初期化時**の到達不能だけです。**settle 時**の失敗は別経路で、`handleSettlement` は `!result.success` のとき facilitator のエラーをそのまま返します（`@x402/next/dist/esm/index.mjs:203-211`）。つまり CDP が無料枠超過や支払い方法未登録でブロックされていると、**買い手が署名した後に決済が落ちます**。
3. **CDP 依存そのものが消える。** 無料枠の崖も、CDP 障害の影響半径も、売り面からはなくなります。per-call（売上の主軸）は元から Solana 単 leg だったので、面が揃いました。

### 引き受けたリスク

- **PayAI が有料面 100% の単一障害点**になりました。PayAI 停止時は全有料エンドポイントが 503（`payment_unavailable` + `Retry-After`）になります。以前は alpha 7 本だけ 2-of-2 の冗長性がありましたが、主力の per-call は元からこの状態でした。
- **Base しか持たない買い手は払えません。** x402 エコシステムは Base 中心なので、ディレクトリ経由の到達性は落ちる可能性があります。`proof/` が空で実決済のログが無いため、**失った需要の量は測れていません**。
- **買い手側に移行コストが出ます。** 上の訂正のとおり AA は Base で払える買い手なので、この変更は AA に「Solana で払え」を強制します。買い手側セッションの報告では **Base に 14.18 USDC、Solana に 6.02 USDC**。Base 残高は遊休化し、全トラフィックが Solana に寄るぶん消費が速くなります。**売り手の都合で買い手の資金を座礁させる変更**である点は明記しておきます（回収するか、Base leg を戻すかは別途判断）。

### 戻し方

**戻す前に必ず読むこと**: 上の追補のとおり、多くの買い手は `accepts[0]` を無条件で選びます。Base を戻すなら **Base を先頭に置かない**（現在 `buildRouteConfig` は Solana 先頭で、テストが固定しています）。CDP の枠・支払い方法が確実に有効であることを確認してからにしてください。先頭に置いた leg が settle できないと、買い手は署名を済ませた後に落ちます。

`buildRouteConfig`（dual-leg ビルダ）・`BASE_NETWORK`・`PAY_TO_BASE`・CDP の facilitator 配線はすべて残してあります。戻すのは **7 ルートの `withSolanaOnlyPaywall` → `withPaywall`** と、記述子に Base leg を足すだけです。`scripts/__tests__/paywall.test.mjs` と `discovery-descriptor.test.mjs` が「Base を広告していないこと」を assert しているので、**戻すときはテストも意図的に書き換える**必要があります（事故で復活しない）。

テストネットの `/api/testnet/signal` は Base Sepolia のままです。CDP とは無関係な `x402.org/facilitator` を使う別インスタンスで、本番の決済経路に影響しません。

Sources:
- [Circle's x402 Facilitator Service goes live on Arc, supports Base and Polygon PoS](https://cryptobriefing.com/circle-x402-facilitator-service-arc-launch/)
- [Monetize Your API for AI Agents with x402 and USDC | Circle](https://www.circle.com/blog/turn-your-api-into-a-storefront-for-agents)
- [What is x402? - Circle Docs](https://developers.circle.com/gateway/nanopayments/concepts/x402)
- [Networks & Token Support - x402](https://docs.x402.org/core-concepts/network-and-token-support)
