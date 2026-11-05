# データの質の改善（2026-11-05）— 実施記録

指示書「OSD データの質の改善（2026-11-05）」の 1〜5 を全銘柄まとめて実施した記録。
before は本番（osd.x402jp.com、#72 マージ前の main と同じ API）と、同じビルドのローカル有料応答。
after はこのブランチのビルドをローカルで起動し、無料はそのまま、有料は `x-internal-key` で取得した。

## 1. 次回決算日（一次資料のみ）

`npm run check:earnings-dates` → data/earnings-dates.json。キー不要。モデルの日付は書かない。

| 市場 | 対象 | confirmed | not_announced | 取得失敗（unverified） |
| --- | ---: | ---: | ---: | ---: |
| JP | 222 | 144 | 78 | 0 |
| US | 1,577 | 1 | 0 | 1,576 |
| 計 | 1,799 | 145 | 78 | 1,576 |

- 対象 = Solana 1,564 銘柄の原資産（ユニーク）＋ Catalysts（IR Fair・Physical AI）＋ Weekly（US・JP）。
- JP の出典: JPX「決算発表予定日」（kessan.xlsx / kessan08_1002.xlsx / kessan09_1030.xlsx、計 3,609 行）。
  JPX の一覧を読めて、その銘柄に今日以降の日付がない → `not_announced`（会社がまだ届け出ていない）。
- US の出典: 会社 IR / プレスリリースで日付を確認した記録（date_checks）だけ。今日以降の日付が残っているのは COST（2026-12-10）の 1 社。
  ほかは鍵なしで機械的に読める一次資料がないため `unverified`（= 取得失敗として数える）。
- 6920 レーザーテック: 10/30 に 1Q 発表済みで、次回は JPX 一覧にまだない → `not_announced`。
- 6594 ニデック: 決算発表を延期中で JPX 一覧にない → `not_announced`。

## 2. 開示済み財務（機械抽出）

`npm run fetch:financials` → data/financials.json。キー不要、推定なし、欠けた値は null。

| 市場 | 出典 | 対象 | 取得 | 取れなかったもの |
| --- | --- | ---: | ---: | --- |
| US | SEC EDGAR XBRL companyfacts | 76 | 56 | 非上場 18（Physical AI の未上場企業）・TGS（us-gaap なし）・ONEX（SEC 登録なし） |
| JP | TDnet 決算短信 XBRL（Summary） | 222 | 74 | 直近 31 日に短信がない 148 社。週次実行で順次たまる |

- US: 四半期（約 90 日）と通期（約 365 日）の売上高・営業利益・純利益・希薄化 EPS。各値に form（10-Q / 10-K）・提出日・EDGAR の提出書類 URL。前年同期は同じ提出書類の比較欄から取り、YoY を計算。
- JP: 売上高・営業利益・経常利益・親会社株主に帰属する当期純利益（累計期間、短信の表記どおり）。各値に短信 PDF の URL と開示時刻。
  検算: レーザーテック 1Q の YoY（-25.5 / -41.0 / -45.8 / -43.7%）は短信自身の対前年増減率と一致。
- SEC への User-Agent は汎用名（`OnchainStockData research bot (osd.x402jp.com)`）。個人のメールアドレスは使っていない。
- 注意: TDnet の PDF は約 1 か月で公開が終わるので、古い source_url はいずれ切れる。

## 3〜4. 応答の形（before / after）

| 確認項目 | before | after |
| --- | --- | --- |
| モデルの日付（`target_date_source: "model"`） | NVDA 有料 7 か所・無料 1 か所 | 0 |
| 意味の分からない接頭辞の id（`ext:` `us:`） | NVDA 有料 10・MSFT 有料 6 | 0（`us-weekly-2026-09-21-NVDA`、`physical-ai-5a1f088b`） |
| id だけの行（latest_verdict が id・status・日付のみ） | 全応答 | 0（全行に question・ticker・target_date・result・evidence_url） |
| 説明文（`date_source_meaning`・`note`・`contains`） | 全応答 | 0（/docs と x402.json の記述へ移した） |
| 財務の値と文書 URL | なし | NVDA・MSFT 各 8 値・6920 4 値、すべて URL 付き |
| 6920 / 6594 / MSFT の会社単位エンドポイント | /api/catalyst は 404 | 無料 `?view=free` 200 / 有料 402 → 200 |

### NVDA 無料 `/api/solana-stocks/NVDA`

before:

```json
"next_earnings": { "date": "2026-11-19", "target_date_source": "model", "source_url": null, "checked_at": null, "condition_id": "us:2026-09-21:NVDA" },
"date_source_meaning": "target_date_source 'verified' = the date was read off … (約 600 字)",
"latest_verdict": { "id": "ext:ext_5a1f088b", "status": "miss", "judged_at": "2026-09-20" },
"full": { "url": "…?view=full", "price": "0.001 USDC per call (Solana, x402 exact)", "contains": "conditions with verdicts, …" }
```

after:

```json
"next_earnings": { "date": null, "status": "unverified", "source_url": null, "checked_at": "2026-11-05T10:04:00.900Z" },
"condition_count": 8,
"result_counts": { "hit": 0, "partial": 3, "miss": 1, "na": 0, "pending": 4, "excluded": 0 },
"latest_verdict": { "id": "physical-ai-5a1f088b", "ticker": "NVDA", "company": "NVIDIA", "population": "Physical AI series",
  "question": "Q2売上が会社ガイダンス910億ドルを上回るか", "fail_direction": "Q2売上が会社ガイダンス910億ドルを下回る場合",
  "target_date": "2026-08-27", "result": "miss", "judged_at": "2026-09-20",
  "evidence_url": "https://www.webull.com/blog/304-Nvidia-Q2-FY2027-Earnings-Beats-Revenue-EPS-Estimates-Guides-Q3-to-108B" },
"full": { "url": "https://osd.x402jp.com/api/solana-stocks/NVDA?view=full", "price_usdc": "0.001", "network": "solana", "scheme": "exact" }
```

### NVDA 有料 `?view=full` — 条件の 1 行

before:

```json
{ "id": "us:2026-09-21:NVDA", "success_condition": "11/19前後のQ3決算で…", "target_date": "2026-11-19",
  "target_date_source": "model", "target_date_confirmed": null, "status": "pending", "evidence_urls": [] }
```

after:

```json
{ "id": "us-weekly-2026-09-21-NVDA", "ticker": "NVDA", "company": "NVIDIA Corp", "population": "US Weekly Selection",
  "question": "11/19前後のQ3決算で…", "target_date": "2026-11-19", "target_date_source_url": null,
  "result": "pending", "evidence_url": null, "evidence_urls": [], "reasoning": null, "verdict_history": [] }
```

after で増えた `financials`（MSFT、10-Q 2026-10-28 提出）:

```json
"eps_diluted": { "value": 4.92, "unit": "USD/shares", "period_start": "2026-07-01", "period_end": "2026-09-30",
  "prior_value": 3.72, "yoy_pct": 32.3, "concept": "us-gaap:EarningsPerShareDiluted", "form": "10-Q", "filed": "2026-10-28",
  "source_url": "https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/0001193125-26-436133-index.htm" }
```

### 6920 `/api/catalyst/6920`

before: 無料・有料とも `{"error":"ticker not found"}` 404。

after（有料）:

```json
"next_earnings": { "date": null, "status": "not_announced", "source_url": null, "checked_at": "2026-11-05T10:04:00.900Z" },
"financials": { "source": "TDnet 決算短信 XBRL", "latest": {
  "title": "2027年6月期　第1四半期決算短信〔日本基準〕　（連結）", "period": "Q1_YTD", "basis": "consolidated",
  "revenue": { "value": 40369000000, "unit": "JPY", "prior_value": 54171000000, "yoy_pct": -25.5,
    "source_url": "https://www.release.tdnet.info/inbs/140120261030560435.pdf", "disclosed_at": "2026-10-30T15:45:00+09:00" }, … } },
"conditions": [ 11 行 ]
```

6594 は条件 7 行。財務は null（決算延期中で、TDnet の直近 31 日に短信がない）。

## 5. import:chat の選定の検証

- 各保有に `success_conditions`（metric・operator（> >= < <=）・threshold（数値と単位）・source_doc）を必須にした。
- thesis が曖昧語（好材料・上振れ・堅調・改善 など）を含み、数値の閾値がなければエラー。
- 既存の条件は書き換えていない。的中率の集計方法も変えていない。基準に合わない記録済みの条件は
  ops/condition-audit.md に一覧した（326 行: A 曖昧語あり・閾値なし 23 / B 閾値なし 114 / C 構造なし 189）。

## 見つかった既存判定の誤り（今回は書き換えていない）

`physical-ai-5a1f088b`（旧 id `ext:ext_5a1f088b`、NVDA Q2 売上が会社ガイダンス 910 億ドルを上回るか）は **miss** と記録されている。
しかし reasoning 自体が「売上 962.2 億ドルでガイダンスを大きく上回った」と書いている（本文の「96.22億ドル」は桁の誤り）。
SEC の 10-Q でも Q2 売上は 96,221 百万ドル。success_condition ではなく【外れ方向】節を判定した、10/15 に直した評価の不具合と同じ形。
evidence も二次資料（webull のブログ）。チャットで `revision_reason` を付けて再判定するのがよい。
