# テーマの棚卸し（2026-11-07）

指示書「OSD テーマ別 Catalysts の per-call 化」と「OSD テーマの整理：記事の版の系譜と IR フェアのセクター分割」の記録。
テーマは「セクター × 市場」。銘柄は最新の版に合わせ、古い版の条件は消さずに status を付けて残す。

## テーマごとの状態（2026-11-07 時点）

| テーマ | 表示名 | 銘柄数 | active | judged | superseded | expired | 最新版 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| neocloud-us | 米国 ネオクラウド | 18 | 23 | 2 | 28 | 2 | [2026-10-20](https://note.com/x402inc/n/n63fa0862b031) |
| neocloud-jp | 日本 ネオクラウド | 5 | 5 | 2 | 9 | 2 | [2026-10-20](https://note.com/x402inc/n/n7b0a50e89402) |
| physical-ai-semis-us | 米国 フィジカルAI 半導体 | 10 | 4 | 18 | 0 | 0 | [2026-07-31](https://note.com/x402inc/n/n1738f5fa8629) |
| physical-ai-robotics-us | 米国 フィジカルAI ロボティクス | 19 | 15 | 11 | 0 | 4 | [2026-07-31](https://note.com/x402inc/n/n00d0d1362d4d) |
| physical-ai-models-us | 米国 フィジカルAI 基盤モデル | 8 | 11 | 0 | 1 | 0 | [2026-07-31](https://note.com/x402inc/n/naee21cd4b6e4) |
| physical-ai-jp | 日本 フィジカルAI | 26 | 19 | 14 | 3 | 3 | [2026-07-31](https://note.com/x402inc/n/n1b8e66c7fa8e) |
| semiconductor-supply-chain-jp | 日本 半導体・AIサプライチェーン | 30 | 7 | 85 | 0 | 54 | [2026-09-04](https://note.com/x402inc/n/n5468ee860649) |
| datacenter-power-jp | 日本 データセンター・電力 | 7 | 1 | 1 | 0 | 4 | [2026-09-24](https://note.com/x402inc/n/n70ffdda17ca4) |
| space-geospatial-jp | 日本 宇宙・空間情報 | 3 | 2 | 0 | 0 | 1 | [2026-09-24](https://note.com/x402inc/n/n70ffdda17ca4) |
| infrastructure-resilience-jp | 日本 インフラ・国土強靭化 | 10 | 0 | 0 | 0 | 6 | [2026-09-24](https://note.com/x402inc/n/n70ffdda17ca4) |
| healthcare-jp | 日本 ヘルスケア・創薬 | 7 | 0 | 0 | 0 | 0 | [2026-09-24](https://note.com/x402inc/n/n604e2379834b) |
| edge-ai-field-dx-jp | 日本 エッジAI・現場DX | 7 | 0 | 0 | 0 | 0 | [2026-08-28](https://note.com/x402inc/n/n0b81556a919b) |
| financials-jp | 日本 金融・株主還元 | 7 | 0 | 0 | 0 | 0 | [2026-08-28](https://note.com/x402inc/n/n0b81556a919b) |
| mobility-auto-parts-jp | 日本 モビリティ・自動車部品 | 5 | 0 | 0 | 0 | 0 | [2026-08-28](https://note.com/x402inc/n/n0b81556a919b) |
| food-staples-jp | 日本 食品 | 9 | 0 | 0 | 0 | 0 | [2026-08-28](https://note.com/x402inc/n/n0b81556a919b) |
| weekly-us | 米国株 Weekly Selection | 10 | 5 | 18 | 0 | 19 | [2026-10-14](https://note.com/x402inc/n/n41d476d52658) |
| weekly-jp | 日本株 Weekly Selection | 9 | 0 | 37 | 0 | 36 | [2026-10-14](https://note.com/x402inc/n/n818c65b295ae) |

- status の意味
  - active：判定時期が未来で、最新版にある条件
  - judged：判定済み
  - superseded：新しい版で差し替わった（`superseded_by` に新しい条件の id）か、新しい版で銘柄から外れた
  - expired：判定時期を過ぎ、まだ判定がない
- 件数は、そのテーマの銘柄が持つ条件をすべて数えたもの。Weekly で選んだ回の条件や、他のテーマの条件も含む。
- 有効な条件が 1 件もない銘柄も、テーマの銘柄一覧には載せる（カタリストは空）。
- 有効な条件がないテーマは、`/api/themes` に `active_catalysts: 0` と出し、一覧の後ろに並べる。
- weekly-us と weekly-jp は「その週の選定」なので、テーマとは別の欄（`selections`）に出す。

## 版の系譜で反映したこと

| テーマ | 反映したこと |
| --- | --- |
| neocloud-us | 7/21 版 20 件・7/31 版 18 件の条件を履歴として取り込んだ（文面が次の版と同じものは重ねない）。7/31 の条件は 10/20 の条件に差し替え（superseded_by）。Nscale・Fluidstack は 7/31 版で外れたので、銘柄に入れない（条件は履歴に残る）。Applied Digital は HPC colocation |
| neocloud-jp | 7/21 版・7/31 版を同様に取り込んだ。GMO インターネットは 4784 |
| physical-ai-robotics-us | 1X Technologies（repo では ONEX）を外し、未判定の条件 1 件を superseded にした |
| physical-ai-models-us | Waabi・Wayve・Genesis AI を外し、未判定の条件 5 件を superseded にした。Applied Intuition の主条件を「Dana の社外提供」に差し替え（旧条件は superseded）。Bedrock Robotics は #75 で取り込み済み |
| physical-ai-jp | Enactic の条件を 7/31 版（介護施設での実証・導入の公表）に差し替え。IR フェアの T3（ナブテスコ・平田機工・ユニオンツール・三菱化工機・タクマ）と新東工業を `group: FA・部品` で追加。オムロンは「見る・読む層」の 1 回だけ |
| フィジカルAI 全体 | 8/19 の判定記事（n424f463e7002）を、8/19 までに判定した 31 件の `source_article` に付けた |

- フィジカルAI の他の条件は、7/31 版と repo の条件が同じ（括弧書きの有無などの文言差だけ）だったので、そのままにした。
- repo 側で後から期日を延ばした条件（Agility・Nuro など、2027 年の期日）は repo を正とした。
- 9449 → 4784 の付け替えは 0 件。repo に 9449 の行はなかった。記事（7/21・7/31）で 9449 だった GMO の条件は、取り込み時に 4784 で入れた（1 件）。

## IR フェアの銘柄の振り分け

IR フェアは出所なので、テーマにしない。各銘柄の `source_article` に記事の URL として残す。

| テーマ | 入れた銘柄 |
| --- | --- |
| semiconductor-supply-chain-jp | T1 の 9 社、6/26 の AI-データセンター5選（イビデン・味の素・日東紡・レーザーテック・ディスコ）、JP Weekly で選んだ半導体の銘柄（東証の業種で判定）、9/04 の装置・材料層の記事にある大真空・富士電機・レゾナック |
| datacenter-power-jp | T2 の 7 社（9 月の 14 銘柄記事の電力・DC の 5 社はすべて T2 に含まれる） |
| space-geospatial-jp | T5 の 3 社（9 月の記事の宇宙の 3 社と同じ） |
| infrastructure-resilience-jp | T6 の 8 社、9 月の記事のインフラにあるレイズネクスト・矢作建設工業。レイズネクストは T2 にもあるので、2 つのテーマに入る |
| healthcare-jp | 9/24 の記事の 6 社と T9 の 5 社の和（7 社） |
| edge-ai-field-dx-jp・financials-jp・mobility-auto-parts-jp・food-staples-jp | T4・T7・T8・T10 の各社。条件はまだない |

- 指示書になかった割り当て：9/04 の記事（日本フィジカルAI 装置・材料層）の会社のうち、T1〜T3 にない 4 社。
  - 大真空・富士電機・レゾナックは半導体へ入れた。
  - 新東工業は physical-ai-jp の FA・部品へ入れた。
- healthcare-jp の 6 社は、記事にカタリストがある。ただし repo では確認前（stage が review）のままなので、条件として数えていない。

## 記事上の判定（10/20 のネオクラウド 2 本、計 23 件）

7 月の条件に、記事が本文で付けた判定。条件ごとの一次資料の URL がないため、verdict にはしていない。
`export:chat` の E-3 に出るので、チャットが一次資料で判定を付けて verdicts で返す（id はそのまま使える）。

| テーマ | 銘柄 | 7月の条件（期日） | 記事上の判定 | 行の id |
| --- | --- | --- | --- | --- |
| neocloud-us | CoreWeave | 2026通期ガイダンス（売上120〜130億ドル）を四半期の積み上げで達成（2027-02-28） | 期日前・進捗あり | `ext:ext_20ccacdc` |
| neocloud-us | Nebius | 契約済み電力を年末までに4GW以上へ拡大し、通年ARRガイダンス70〜90億ドルを維持（2026-12-31） | 一部達成 | `ext:ext_a0f484b0` |
| neocloud-us | IREN | 2026年末までにAIクラウド容量480MWを納入し、ARR目標（40億ドル超）へ接続（2026-09-01） | 期日前・進捗あり（遅れ気味） | `ext:ext_ebfef08d` |
| neocloud-us | Applied Digital | 2027年稼働予定の2キャンパスについて、FY2027中に追加の資金調達が完了し、稼働開始時期が後ろ倒しされない（2026-10-10） | 期日前・進捗なし | `ext:ext_425f3501` |
| neocloud-us | Cipher Mining | Barber Lake第1期（168MW）を2026-09-30までにFluidstackへ納入（2026-09-30） | 未達 | `ext:ext_e0785097` |
| neocloud-us | TeraWulf | Lake MarinerのCB-5（160MW）を2026年後半に稼働開始（2026-12-31） | 未達見込み | `ext:ext_d8f2d325` |
| neocloud-us | Core Scientific | 2026年末までに課金対象コロケーション容量250MWを納入（2026-12-31） | 達成 | `ext:ext_d59559c0` |
| neocloud-us | Hut 8 | River Bend第1データホールを2027年初頭までに稼働（2027-03-31） | 未達見込み | `ext:ext_25d87468` |
| neocloud-us | HIVE Digital | Bell/Cohere向けGB200を2026年内に稼働させ、契約HPC ARRを3,500万ドルの実現分から1億ドル超へ（2026-12-31） | 一部達成 | `ext:ext_6121fc71` |
| neocloud-us | WhiteFiber | 2026年末までにデータセンター容量76MWへ拡大し、年換算売上1.39億ドルへ接続（2026-12-31） | 期日前・進捗あり | `ext:ext_629db464` |
| neocloud-us | Lambda | 2026年後半までにIPO（またはS-1提出）を実施（2026-12-31） | 未達見込み | `ext:ext_3c5c4a5e` |
| neocloud-us | Crusoe | アビリーン（Stargate）の稼働棟を増やし、2026通期売上約20億ドルへ接続（2026-12-31） | 一部達成 | `ext:ext_23c07e41` |
| neocloud-us | Together AI | Series Cで確保した500MW超のコンピュートを2026年内に展開開始（2026-12-31） | 期日前・進捗あり | `ext:ext_b7fa47cd` |
| neocloud-us | TensorWave | AMD Instinct MI355Xクラスタを展開し、契約済み500MWの稼働化を進める（2026-12-31） | 未達見込み | `ext:ext_6c10d04c` |
| neocloud-us | Vultr | 2026年内に新規10億ドル超の資金調達を確定し、Ohio（50MW/AMD MI355X）を立ち上げ（2026-12-31） | 期日前・進捗なし | `ext:ext_ab45dd5d` |
| neocloud-us | Lightning AI | 統合後の統一プラットフォームで、GB300を含む容量の稼働を拡大（2026-12-31） | 判定不能 | `ext:ext_5e8ff6e9` |
| neocloud-us | SF Compute | Series A後にマーケットプレイスの取扱を拡大し、余剰容量の再販流動性を高める（2026-12-31） | 達成 | `ext:ext_73b8becf` |
| neocloud-us | Foundry | 2026年内に新規調達または大型商用契約を公表（2026-12-31） | 期日前・進捗なし | `ext:ext_5a2f7d60` |
| neocloud-jp | さくらインターネット | FY2027（2027年3月期）売上450億円（前期比+27.5%）・営業利益15億円を達成（2027-03-31） | 期日前（会社予想が条件を上回る） | `ext:ext_58af7e59` |
| neocloud-jp | データセクション | FY2027（2027年3月期）もAIインフラ事業を軸に増収を継続（2027-03-31） | 期日前（第1四半期は大幅増収） | `ext:ext_12136a10` |
| neocloud-jp | GMOインターネット | HGX B300クラウドと産総研・チューリング向け提供を軸にGPUクラウド売上を拡大（2026-12-31） | 主条件は判定不能、補助線は達成 | `ext:ext_2c165785` |
| neocloud-jp | ソフトバンク | 「AIデータセンターGPUクラウド」（Infrinia AI Cloud OS＋GB200 NVL72）を2026年10月に提供開始（2026-10-31） | 期日前（10月31日まで） | `ext:ext_6d776fa6` |
| neocloud-jp | KDDI | 大阪堺データセンターのKDDI GPU Cloud（GB200 NVL72）を2026年内に商用展開（2026-01-31） | 前稿公開時点で達成済み | `ext:ext_87a841b1` |

## 取り込めなかった条件（補助線）

10/20 の補助線のうち、次のものは取り込んでいない。

- 期日がないもの
- 開示ではなく、CDS などの市場データで判定するもの
- 判定の向きがないもの（さくらインターネットの「通期予想の再修正の有無」）

対象は CoreWeave 2 件、IREN、Applied Digital、Cipher Mining、Core Scientific、Crusoe、TensorWave、Vultr、さくらインターネット、GMO インターネット、KDDI の計 12 件。

- 前回は Foundry の主条件を「大型」に基準がないため取り込まなかった。
- 今回は、7/31 版の条件を記事のとおり履歴として残した。10/20 版でも据え置きなので、active として数えている。
- この条件は、#73 で決めた条件の形にはまだなっていない。
