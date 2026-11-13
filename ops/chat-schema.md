# チャット運用の返答スキーマ

2026-10-28 から、選定と判定は Actions の API 呼び出しではなくチャットで行う。

```
npm run export:chat            → ops/chat-input/YYYY-MM-DD.md   （CC が書き出す）
チャット（claude-fable-5-1）    → 返答 JSON                         （選定・判定）
npm run import:chat -- a.json  → data/ を更新して 1 コミット         （CC が取り込む）
```

書き出しも取り込みも、ネットワーク・API・web 検索を使わない（費用ゼロ）。

例外は一次資料の書き出し `npm run export:chat:primary` だけで、TDnet と JPX を読む（キー不要・費用ゼロ）。
チャットから開けない日本株の一次資料を `ops/chat-input/YYYY-MM-DD-primary.md` に載せる。

- F 節：A 節の日本株について、決算短信 XBRL の値、セグメント、受注の記載、予想修正の表、説明資料の該当ページ
- G 節：E・E-2 節の日本株について、通期予想と次の決算発表日（JPX）
- H 節：D 節の日本株について、JPX の予定日

通常の書き出しと一緒にチャットへ渡す。

返答は **1ファイル1種類**。種類は `type` で指定する。取り込み1回につき1コミットで、
コミットメッセージに種類と件数が入る。返答そのものは `ops/chat-output/` に残る。
`--dry-run` を付けると検証だけして何も書かない。

記録者の名前は必ず `"claude-fable-5-1 (chat)"`（以下 CHAT_MODEL）。

## 行の id

書き出しファイルの A・D 節に出る id をそのまま使う。

| id | 行の場所 |
| --- | --- |
| `us:<week_of>:<ticker>` | data/portfolio-evaluations.json |
| `jp:<week_of>:<ticker>` | data/jp-portfolio-evaluations.json |
| `ext:<catalyst_id>` | data/external-catalysts.json（Physical AI） |
| `irf:<catalyst_id>` | data/ir-fair-2026-catalysts.json（active のみ） |

## 1. verdicts（判定）

```json
{
  "type": "verdicts",
  "items": [
    {
      "id": "us:2026-09-21:JPM",
      "status": "hit",
      "reasoning": "10/14 の Q3 決算で 2026 年 NII 見通しを約 X 億ドルへ引き上げた。",
      "evidence_url": "https://www.jpmorganchase.com/ir/quarterly-earnings",
      "evaluated_at": "2026-10-28T09:00:00Z",
      "evaluator": "claude-fable-5-1 (chat)"
    }
  ]
}
```

| 項目 | 必須 | 規則 |
| --- | --- | --- |
| id | ○ | 書き出しにある id |
| status | ○ | `hit` / `partial` / `miss` / `na` |
| reasoning | ○ | 空不可。success_condition に対して何が観測されたか |
| evidence_url | ○ | http(s) の URL。**URL のない判定は取り込まない** |
| evaluated_at | ○ | ISO 時刻（`2026-10-28T09:00:00Z`） |
| evaluator | ○ | CHAT_MODEL と完全一致 |
| revision_reason | 再判定のみ | 判定済みの行を判定し直すときの理由 |

取り込みの規則:

- 判定するのは success_condition だけ。fail_direction の成否は判定しない。
- **判定は上書きしない。** 判定済み（pending 以外）の行は `revision_reason` がなければ不採用。
  ある場合も、旧値（status・判定日・evidence・reasoning・evaluator）は `verdict_history` に移してから新しい値を書く。
- `excluded` の行（上場廃止などで母集団から外れた条件）は判定しない。
- 判定可能日 `max(target_date, target_date_confirmed) + 7日` より前の `evaluated_at` は不採用。
- 不採用の項目は理由つきで表示し、残りは取り込む。1件も取り込めなければ非ゼロ終了。

## 2. selection（週次の選定）

```json
{
  "type": "selection",
  "market": "JP",
  "week_of": "2026-11-02",
  "model": "claude-fable-5-1 (chat)",
  "horizon": "1m",
  "rationale": "選定の理由（全体）",
  "used_external_data": false,
  "external_source": null,
  "holdings": [
    {
      "ticker": "8035",
      "company_name": "東京エレクトロン",
      "weight": 16,
      "thesis": "11/6発表のQ2決算で、半導体製造装置の受注高が前年同期比 +15% 以上なら当たり。",
      "success_conditions": [
        {
          "metric": "半導体製造装置 受注高 前年同期比",
          "operator": ">=",
          "threshold": { "value": 15, "unit": "%" },
          "source_doc": "2027年3月期 第2四半期 決算短信・決算説明資料"
        }
      ],
      "target_date": "2026-11-06",
      "target_date_source": "verified",
      "target_date_source_url": "https://www.tel.co.jp/ir/"
    }
  ]
}
```

| 項目 | 必須 | 規則 |
| --- | --- | --- |
| market | ○ | `JP` / `US` |
| week_of | ○ | 月曜日。記録済みの週・最新週より古い週は不可（**公表済みの週は差し替えない**） |
| model | ○ | CHAT_MODEL と完全一致 |
| rationale | ○ | 空不可 |
| used_external_data | ○ | true / false。チャットが外部データを見たかどうか |
| holdings | ○ | 1〜10 行。ticker 重複不可 |
| holdings[].weight | ○ | 正の数。合計 100（±0.5）。US は 1 銘柄 15 まで |
| holdings[].thesis | ○ | 判定条件そのもの（文章）。期日と数値の基準を含める。曖昧語（下記）を数値の閾値なしで使わない |
| holdings[].success_conditions | ○ | 1 行以上。thesis を判定できる形に分けたもの（下記）。複数あるときはすべて満たして当たり |
| success_conditions[].metric | ○ | 何を測るか（例: 「データセンター売上 前年同期比」「営業利益率」）。曖昧語は不可 |
| success_conditions[].operator | ○ | `>` / `>=` / `<` / `<=` |
| success_conditions[].threshold | ○ | `{ "value": 数値, "unit": "単位" }`。単位は `%`・`億円`・`USD`・`倍`・`pt` など |
| success_conditions[].source_doc | ○ | 何の文書で判定するか（決算短信、10-Q、決算説明資料、8-K の Exhibit 99.1 など） |
| holdings[].target_date | ○ | YYYY-MM-DD、week_of 以降 |
| holdings[].target_date_source | ○ | `model`（推定）/ `verified`（会社の公表日） |
| holdings[].target_date_source_url | verified のとき | 公表日を確認した IR ページ |

曖昧語: `好材料` `上振れ` `下振れ` `堅調` `改善` `好調` `順調` `底堅` `底打ち` `回復基調` `増益基調` `拡大基調` `力強い` `良好`
（scripts/lib/chat-ops.mjs の `VAGUE_WORDS`）。thesis がこれらを含み、数値の閾値（数値＋単位。
例 `+15%`・`1,000億円`・`$40B`・`二桁`）を含まなければエラー。metric に曖昧語があればそれだけでエラー。

取り込みの規則:

- **条件は判定できる形で受け取る。** success_conditions が欠けている・operator が4種以外・threshold が数値でない・
  単位や source_doc が空・曖昧語だけで閾値がない、のどれかがあれば、その選定は丸ごと不採用。
  受け取った success_conditions は保有行と評価行の両方に保存する。的中率の集計方法は変えない（判定は従来どおり hit / partial / miss / na）。
- **既存の条件は書き換えない。** この基準に合わない記録済みの条件は `npm run audit:conditions` が
  ops/condition-audit.md に一覧する（区分 A: 曖昧語あり・閾値なし / B: 閾値なし / C: 構造なし）。
- **JP は上場廃止スクリーンを通す。** data/jp-listed.json（JPX 上場銘柄一覧）にない銘柄は除外し、
  比率を 100 に再正規化し、`excluded_holdings` に記録する。上場一覧がなければ取り込まない。
- 前週との差分（changes）は既存の選定と同じ関数で計算する。
- 新しい週の各銘柄は、その場で pending として評価ファイルに登録する。
- 規則に1つでも反したら、その選定は丸ごと不採用（部分的には取り込まない）。

## 3. signals（外部シグナル）

```json
{
  "type": "signals",
  "items": [
    {
      "claim": "一行の主張",
      "source_url": "https://…",
      "source_tier": "primary",
      "verified": true,
      "tickers": ["6857"],
      "observed_at": "2026-10-27",
      "direction": "bullish",
      "basis": "根拠（任意）"
    }
  ]
}
```

| 項目 | 必須 | 規則 |
| --- | --- | --- |
| claim | ○ | 空不可 |
| source_url | ○ | http(s) の URL |
| source_tier | ○ | `primary` / `secondary` / `opinion` / `leak` |
| verified | ○ | 一次資料で確認したか |
| tickers | ○ | 配列（空でもよい） |
| observed_at | ○ | YYYY-MM-DD |
| direction | − | `bullish` / `bearish` / `structural`（省略時 structural） |
| id / scope / basis / judgeability | − | 省略時は自動。judgeability は `context`（採点しない） |

- `verified: false` も保存する。書き出しの C 節では「未検証」と明示し、選定の根拠にしない。

## 4. date_checks（判定日の照合）— 書き出しの D 節への返答

指示書の3種類に加えた補助の種類。D 節（target_date が model のままの行）に、会社の公表日を返すためのもの。

```json
{
  "type": "date_checks",
  "items": [
    {
      "ids": ["us:2026-10-12:MSFT", "us:2026-10-19:MSFT"],
      "confirmed_date": "2026-10-29",
      "source_url": "https://www.microsoft.com/en-us/investor"
    }
  ]
}
```

- `target_date` は書き換えない（条件は公表時点で固定）。公表日は `target_date_confirmed` として横に置き、
  `target_date_source` を `verified`、`target_date_checked_at` を取り込み日にする。
- 採点は `max(target_date, target_date_confirmed) + 7日` から。

## 5. theme_catalysts（テーマの新しいカタリスト）— 書き出しの E 節への返答

E 節に出たテーマの銘柄に、次のカタリストを足すためのもの。取り込んだその日から
`/api/themes/{theme}` と `/api/catalyst/{ticker}` に出る。判定は他の行と同じく verdicts で返す（id は `ext:<catalyst_id>`）。

```json
{
  "type": "theme_catalysts",
  "author": "claude-fable-5-1 (chat)",
  "items": [
    {
      "theme": "neocloud-us",
      "market": "US",
      "ticker": "CRWV",
      "company_name": "CoreWeave",
      "listed": true,
      "question": "第4四半期売上が会社ガイダンスの下限を上回る",
      "fail_direction": "第4四半期の未達、または通期ガイダンスの引き下げ",
      "success_conditions": [
        { "metric": "Q4 2026 revenue", "operator": ">=", "threshold": { "value": 4.1, "unit": "USD bn" }, "source_doc": "Q4 2026 earnings release (8-K Ex.99.1)" }
      ],
      "target_date": "2027-02-25",
      "date_confidence": "estimated",
      "source_url": "https://investors.coreweave.com/",
      "role": "main"
    }
  ]
}
```

| 項目 | 必須 | 規則 |
| --- | --- | --- |
| author | ○ | CHAT_MODEL、または記事から取り込むときは `"article"` |
| theme | ○ | data/themes.json の id |
| market | ○ | `US` / `JP` |
| ticker | ○ | 上場は証券コード・ティッカー。未上場は `listed: false` と英大文字のスラッグ（例 `LAMBDA`） |
| question | ○ | 判定する条件の文章。曖昧語だけで数値の閾値がないものは不可 |
| success_conditions | ○ | selection と同じ（metric・operator・threshold・source_doc）。公表の有無を問う条件は `{"value": 1, "unit": "event"}` |
| target_date | ○ | YYYY-MM-DD |
| date_confidence | ○ | `confirmed`（会社が公表した日・条件の締切日）/ `estimated`（「11月中旬見込み」など幅のある日） |
| source_url | ○ | カタリストを出した場所（記事・IR ページ） |
| role / parent_index | − | 補助線は `"role": "sub"` と、同じ返答の中の主条件の位置（0 始まり） |

- 同じテーマ・銘柄・期日・文面のものは「already on record」で不採用（再送しても重ならない）。
- 不採用の項目は理由つきで表示し、残りは取り込む。
- selection の各行には `themes`（data/themes.json の id の配列、任意）を付けられる。付けなくても、
  その銘柄がすでに属するテーマは取り込み時に自動で付く。

## 6. metrics（ネオクラウドの数値）— 書き出しの F 節・ネオクラウド書き出しへの返答

ネオクラウド（data/themes.json の `neocloud-us` 18社・`neocloud-jp` 5社）の事業の数字を、開示のたびに 1 行ずつ記録する。
条件や判定ではなく、時系列の記録。`data/neocloud-metrics.json` に入り、`/api/neocloud/{ticker}` と
`/api/themes/neocloud-us`（`neocloud-jp`）に出る。

```json
{
  "type": "metrics",
  "items": [
    {
      "ticker": "CRWV",
      "item": "contracted_power_mw",
      "value": 2900,
      "unit": "MW",
      "as_of": "2026-09-30",
      "source_url": "https://www.sec.gov/Archives/edgar/data/1769628/.../crwv-20260930.htm",
      "published_at": "2026-11-12"
    },
    {
      "ticker": "CRWV",
      "item": "revenue_guidance",
      "value": null,
      "low": 5100000000,
      "high": 5300000000,
      "unit": "USD",
      "period": "Q4 2026",
      "as_of": "2026-11-10",
      "source_url": "https://www.sec.gov/Archives/edgar/data/1769628/.../ex99-1.htm",
      "published_at": "2026-11-10"
    },
    {
      "ticker": "CIFR",
      "item": "financing",
      "value": 1400000000,
      "unit": "USD",
      "as_of": "2026-10-13",
      "detail": { "instrument": "senior secured notes", "rate": "7.125%", "maturity": "2030-11-15" },
      "source_url": "https://www.sec.gov/Archives/edgar/data/1819989/.../d134900d8k.htm",
      "published_at": "2026-10-13"
    }
  ]
}
```

（上の数字と URL は形の例で、実際の値ではない。）

| 項目 | 必須 | 規則 |
| --- | --- | --- |
| ticker | ○ | ネオクラウドの 23 社のどれか（未上場は `LAMBDA` などのスラッグ） |
| item | ○ | `contracted_power_mw` 契約済みの電力容量 / `energized_mw` 稼働（通電・課金開始）している容量 / `backlog_usd` 受注残・RPO / `revenue_guidance` 売上ガイダンス / `capex_guidance` 設備投資ガイダンス / `financing` 社債・融資・増資 / `key_contracts` 顧客との契約 |
| value | ○ | 書類に書いてある数字そのもの。**書いていなければ `null`**。推定・按分・換算した値は入れない |
| unit | ○ | 電力の 2 項目は `MW`（GW は MW に直す）。それ以外は `USD` か `JPY` の**全額**（例 55.6 億ドル → `5560000000`） |
| low / high | − | ガイダンスが幅のとき。このとき value は `null` でよい |
| period | ガイダンスは○ | ガイダンスの対象期間（`FY2026`、`Q4 2026`、`2027年3月期`） |
| as_of | ○ | 数字の時点（四半期末、契約・調達の発表日、ガイダンスを出した日）。published_at より後にはできない |
| detail | 一部○ | `financing` は `instrument`（社債・タームローン・増資など）が必須、`rate`・`maturity`・`lender` は任意。`key_contracts` は `counterparty`（名前が出ていなければ `非開示`）が必須、`term`・`mw` は任意 |
| source_url | ○ | 数字が載っている書類そのもの（10-Q・8-K の本文や Ex.99.1、決算短信・説明資料の PDF、未上場は会社の公式発表）。転載ページは不可 |
| published_at | ○ | その書類の提出日・公表日 |
| note | − | 定義の違い（「契約済み」が LOI を含むかなど）を一文で |

- 次の書き方は、取り込み時にスキーマの形へ読み替える（名前の付け替えと単位の正確な倍率だけで、数字は推測しない）。
  `metric` → `item`、`value_high` / `value_low` → `high` / `low`（このとき value は幅の下限として low に移る）、
  `USD bn`・`USD m`・`USD thousand`・`億円`・`百万円`・`千円`・`GW` → USD / JPY の全額・MW、ガイダンスで `as_of` が対象期間の末日のもの →
  `period: "〜その日"` と、公表日を `as_of` にしたもの。
- 転載・まとめサイト（menafn・finviz・placera・finanznachrichten・stockhub など）の URL は不採用。書き出しにある
  SEC の書類（8-K の Ex.99.1、10-Q）か、会社 IR・配信元（GlobeNewswire 等）の URL を使う。
- 取り込みの前に `npm run neocloud:sources -- <返答.json> --out <確認済み.json>` で、各行の数字がその書類に
  印字されているかを確かめる。見つからない行は、同じ日の EDGAR の書類で見つかればその書類に置き換え、
  どこにもなければ外して `-dropped.json` に残し、チャットに返す。
- `estimated` などの推定の印が付いた行は不採用。
- 同じ会社・項目・時点・書類のものは「already recorded」で不採用（再送しても重ならない）。
- 開示がない項目は `value: null` の行で返してよい（その書類を見たが書いていない、という記録になる）。
- 書類で見つけた事業の出来事（新しい契約・稼働の遅れなど）は、数字にならないものを `signals` で返す。
  `tickers` にティッカー、`source_url` に書類、`observed_at` に書類の日付を入れると、`/api/neocloud/digest` の要約に出る。

## 切替日（別集団としての集計）

data/operation-eras.json に、取り込みが初回に自動で書く。以後は動かさない。

| 項目 | 意味 |
| --- | --- |
| `selection_chat_from.US` / `.JP` | チャット選定の最初の週（week_of） |
| `verdicts_chat_from` | チャット判定を最初に取り込んだ日 |

US の自動登録開始週（`US_AUTOREGISTER_FROM = 2026-09-21`）と同じ扱い。
`lib/operation-era.ts` の `selectionEra` / `splitByEra` で、切替週より前（API 選定）と以後（チャット選定）を
別の集団として集計する。判定者は各行の `evaluator` でも区別できる（チャット判定は CHAT_MODEL）。
