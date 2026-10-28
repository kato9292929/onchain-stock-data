# 日本株のカバレッジ

as of 2026-10-28。数字は data/ の各ファイルから数えたもの。最終更新日は各データファイルの最終コミット日。

## 一覧

| 母集団 | 銘柄数 | 選び方 | 条件の有無と件数 | 判定済み件数 | 配信先（API・MCP・ページ） | 最終更新日 |
| --- | --- | --- | --- | --- | --- | --- |
| JP Weekly Selection | 22（全15週 2026-06-22〜10-19 のユニーク。うち 6967 は上場廃止） | 毎週、36 社のユニバース（AI・半導体・DC サプライチェーン, `lib/jp-portfolio.ts`）から10銘柄をモデルが選定。2026-10-28 以降はチャットで選定し、JPX 上場一覧で照合 | あり・142件（各週の thesis が条件。pending 59・excluded 2） | 81（hit 31 / partial 16 / miss 13 / na 21） | API: `/api/alpha/jp/portfolio/current`（有料）, `/api/alpha/jp/scorecard`（有料）／MCP: `portfolio_get`（market=JP）／ページ: `/portfolio/jp` | 2026-10-28 |
| Physical AI 日本企業 | 23（上場 11・未上場 12） | 連載「Physical AI」第1・2回で取り上げた日本企業（記事起点の手選び） | あり・33件（成立条件【外れ方向】付き。pending 19） | 14（hit 13 / miss 1） | API: `/api/alpha/catalysts/physical-ai`（無料）, `/api/alpha/catalyst/{id}/score`（有料）, `/api/catalyst/{ticker}`（有料・上場分）／MCP: `catalysts_list`, `scoreboard_get`／ページ: `/catalysts/physical-ai`, `/catalysts/physical-ai-1`, `-2` | 2026-10-15 |
| IR Fair 2026 | 197（active 27 / review 23 / draft 147） | 日経 IR フェア 2026 の出展企業名簿。一次資料で裏取りした社から active に昇格 | active 27件（採点対象）・review 23件（条件は書いたが人の確認前・未採点）・draft 147社は条件なし | 0（active 27件はすべて pending。最初の期日は 2026-10-27） | API: `/api/catalyst`（無料・索引）, `/api/catalyst/{ticker}`（有料）／MCP: なし／ページ: `/catalysts`, `/catalysts/{sector}` | 2026-10-15 |
| ネオクラウド記事の日本5社 | — | **リポジトリにデータなし**（data/ にも lib/ にも該当する名簿・条件はない。"neocloud" は US 評価の reasoning 中の一語のみ） | — | — | — | — |
| EDINET（サブ） | 固定の名簿なし（呼び出しごとに EDINET コードを指定） | 呼び出し側が指定した会社の最新の有報・四半期・半期報告を EDINET API v2 から探す | なし（条件を持たない） | — | API: `/api/edinet`（無料・説明）, `/api/edinet/{code}`（有料）／MCP: なし／ページ: なし | — |
| 上場銘柄マスタ | 4,447（JPX 上場銘柄一覧 as_of 2026-09-30） | JPX の data_j.xlsx 全件（`scripts/refresh-jp-listed.mjs`） | なし（照合用） | — | 外部配信なし。JP 選定の上場廃止スクリーンと IR Fair の市場区分の照合に内部で使う | 2026-10-14 |

注:

- **EDINET はサブ扱い**。返すのは書類のメタデータ（提出者名・書類 ID/種別・提出日時・会計期間）だけ。
  財務値（売上・営業利益・純利益）は抽出を停止中（`lib/edinet.ts` の `FINANCIALS_ENABLED = false`）で、
  null と `financials_available:false` を返す。今後も財務データの取得は行わない。
- Physical AI の「未上場 12」は PFN・MUJIN・TELEXIST・TURING・GROOVEX・ENACTIC・AVATARIN・STOCKMARK・
  SAKANA・CLOSER・LEXXPLUSS・CONNROBO。売買シグナルではなく、判定は開示された事実（提携・製品・調達）で行う。
- IR Fair の review は条件と期日があるが採点しない（有料の `/api/catalyst/{ticker}` で売るのは active のみ）。
- 判定済み件数の的中率の式は `(hit + partial×0.5) ÷ (hit + partial + miss + na)`。excluded と pending は分母に入らない。

## 重複

複数の母集団に入っている銘柄（上場銘柄マスタと EDINET は除く。マスタは全上場銘柄を含むため）。

| ticker | 会社名 | JP Weekly Selection | Physical AI | IR Fair 2026 |
| --- | --- | --- | --- | --- |
| 2802 | 味の素 | ○ | | ○ |
| 3110 | 日東紡績 | ○ | | ○ |
| 4004 | レゾナック・ホールディングス | ○ | | ○ |
| 4062 | イビデン | ○ | | ○ |
| 6504 | 富士電機 | ○ | | ○ |
| 6981 | 村田製作所 | ○ | | ○ |
| 6645 | オムロン | | ○ | ○ |
| 9434 | ソフトバンク | | ○ | ○ |

- 3つすべてに入っている銘柄はない。
- JP Weekly Selection と Physical AI の重複もない。
- 母集団をまたいで条件は別々に立っており、同じ銘柄でも的中率は母集団ごとに集計している。

## 更新方法

この表は手で更新する。数えるファイルは `data/jp-portfolio-history.json` と `data/jp-portfolio-evaluations.json`
（JP Weekly）、`data/external-catalysts.json` の `country: "JP"`（Physical AI）、`data/ir-fair-2026-catalysts.json`
（IR Fair）、`data/jp-listed.json`（マスタ）。
チャット運用（`ops/chat-schema.md`）の選定を取り込むと JP Weekly Selection の銘柄数・条件件数が変わる。
