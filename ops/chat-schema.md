# チャット運用の返答スキーマ

2026-10-28 から、選定と判定は Actions の API 呼び出しではなくチャットで行う。

```
npm run export:chat            → ops/chat-input/YYYY-MM-DD.md   （CC が書き出す）
チャット（claude-fable-5-1）    → 返答 JSON                         （選定・判定）
npm run import:chat -- a.json  → data/ を更新して 1 コミット         （CC が取り込む）
```

書き出しも取り込みも、ネットワーク・API・web 検索を使わない（費用ゼロ）。

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
      "thesis": "10/30発表のQ2決算で…なら当たり。",
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
| holdings[].thesis | ○ | 判定条件そのもの。期日と数値の基準を含める |
| holdings[].target_date | ○ | YYYY-MM-DD、week_of 以降 |
| holdings[].target_date_source | ○ | `model`（推定）/ `verified`（会社の公表日） |
| holdings[].target_date_source_url | verified のとき | 公表日を確認した IR ページ |

取り込みの規則:

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

## 切替日（別集団としての集計）

data/operation-eras.json に、取り込みが初回に自動で書く。以後は動かさない。

| 項目 | 意味 |
| --- | --- |
| `selection_chat_from.US` / `.JP` | チャット選定の最初の週（week_of） |
| `verdicts_chat_from` | チャット判定を最初に取り込んだ日 |

US の自動登録開始週（`US_AUTOREGISTER_FROM = 2026-09-21`）と同じ扱い。
`lib/operation-era.ts` の `selectionEra` / `splitByEra` で、切替週より前（API 選定）と以後（チャット選定）を
別の集団として集計する。判定者は各行の `evaluator` でも区別できる（チャット判定は CHAT_MODEL）。
