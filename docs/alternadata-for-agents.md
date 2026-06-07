# AlternaData for agents

**AI エージェント向けの、検証可能な代替データ (alternative data) サービス**構想。
osd (onchain-stock-data) を土台に、エージェントが「予測・仮説を投げ込み、後日その当落が客観的に採点されて返ってくる」ループを提供する。

## なぜ

LLM エージェントは株式の catalyst（決算ビート、FDA 承認、契約獲得…）について仮説を立てられるが、**その仮説が当たったかを後で誰も採点しない**。osd は既に内部で Claude Portfolio の各 thesis を catalyst として日次採点している（`evaluate-catalysts`：Claude + web search で hit/partial/miss/na、evidence URL は検索結果に実在したものだけ採用）。この採点エンジンを外部エージェントに開放すれば、

- エージェントは自分の予測の **track record（的中率）** を蓄積できる
- 採点は LLM の自己申告ではなく、**対象日後の実ニュース・株価・SEC ファイリングに基づく外部検証**
- すべて git にコミットされ **改竄不能・透明**

という、エージェント向けの prediction-like データ層になる。

## Phase A（本実装）— External Catalyst Scoring Endpoint

最初の入口。外部から catalyst を投稿し、判定結果を引ける。

| endpoint | 概要 |
|----------|------|
| `POST /api/alpha/catalyst/submit` | catalyst を投稿（ticker / description / target_date）。`catalyst_id` を返す。 |
| `GET /api/alpha/catalyst/:id/score` | 判定結果（pending / hit / partial / miss / na + evidence + reasoning）。 |

- 採点は内部 portfolio catalyst と**同じ評価エンジン**（`scripts/evaluate-catalysts.mjs`）が日次で実行。`target_date + 7 日`の grace 経過後に判定。
- 重複投稿（同 ticker + description + target_date）は同一 `catalyst_id` を返す。
- abuse 防止に同一 IP / 日 10 件のレート制限（memory-based MVP）。
- データは `data/external-catalysts.json` に保存、GitHub Actions が git commit（Vercel FS は揮発性のため）。

### スコープ外（Phase A1+ で別途）

- x402 ペイウォール（例 $0.05 / submission）と API key 認証
- 法人向け SLA・過去判定の bulk export
- 判定完了時の webhook 通知（`submitter_contact` 宛）
- 共有レート制限ストア（Vercel KV / Upstash）への置き換え

## 将来の Phase（構想）

- **Phase A1 — 課金と認証**：x402 でマイクロペイメント化し、API key でエージェント単位の集計を可能に。
- **Phase B — エージェント track record**：submitter 単位の的中率・キャリブレーションを公開リーダーボード化。「どのエージェントの catalyst 予測が当たるか」を比較可能に。
- **Phase C — 構造化代替データ**：catalyst を超えて、数値予測（目標株価、決算サプライズ幅）や確率予測を受け付け、Brier score / log-loss で採点。
- **Phase D — フィードバックループ**：採点済みデータを osd 自身の Claude Portfolio / predict の入力に還元し、検証済み外部シグナルで内部選定を強化。

いずれも「**エージェントが投げた予測を、時間が経ってから客観的に採点して返す**」という Phase A の核を共有する。

## 関連実装

- 外部 endpoint: `app/api/alpha/catalyst/submit`, `app/api/alpha/catalyst/[catalyst_id]/score`
- 共有ロジック: `lib/external-catalysts.ts`, `lib/rate-limit.ts`
- 採点エンジン: `scripts/evaluate-catalysts.mjs`（内部 + 外部の両方を判定）
- 採点ワークフロー: `.github/workflows/evaluate-catalysts.yml`（日次）
- データ: `data/external-catalysts.json`, `data/portfolio-evaluations.json`
- 公開スコアカード: `GET /api/alpha/portfolio/scorecard`

> 免責: 本サービスは情報提供であり投資助言ではありません。
