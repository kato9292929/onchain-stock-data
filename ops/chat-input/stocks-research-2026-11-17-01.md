# 米国株リサーチ 2026-11-17 — 第 1 回（25 社）

各社に、次に発表される四半期について **条件を 1 つ** 置く。判定は人もモデルも使わず、10-Q / 10-K の XBRL の数字と基準を機械的に比べる（scripts/judge-stocks-edgar.mjs）。

## 決まり

- metric は `revenue` / `operating_income` / `net_income` / `eps_diluted` のどれか 1 つ。ほかの数字（受注残・ARR・セグメント売上など）は使わない。
- threshold は、会社のガイダンス（決算発表・決算説明会・8-K）を根拠にする。ガイダンスがなければ、下の実績から根拠を書いて置く。根拠は basis に 1〜2 文、出どころの URL を source_url に。
- 単位：revenue / operating_income / net_income は **USD mn**（百万ドル）、eps_diluted は **USD per share**。
- fiscal_period / fiscal_year は会社の会計年度で書く。**Q4（10-K で報告される期）に eps_diluted は使えない**（10-K は通期しか載らず、EPS は引き算で出せない）。
- period_end はその四半期の末日。target_date は決算発表の予定日（会社が公表していれば confirmed、なければ過去の発表日から推定して estimated）。
- 条件を置けない会社（ガイダンスも実績もない、上場廃止の予定など）は items に入れない。無理に作らない。

## 返す JSON

```json
{
  "type": "stock_catalysts",
  "author": "claude-fable-5-1 (chat)",
  "items": [
    {
      "ticker": "AAPL",
      "company_name": "Apple Inc.",
      "metric": "revenue",
      "fiscal_period": "Q1",
      "fiscal_year": 2027,
      "period_end": "2026-12-26",
      "operator": ">=",
      "threshold": 138000,
      "basis": "（例）会社ガイダンスの前年同期比の伸びを、前年同期の実績に掛けた値。",
      "source_url": "https://www.sec.gov/…",
      "target_date": "2027-01-29",
      "date_confidence": "estimated"
    }
  ]
}
```

取り込み：`node scripts/import-from-chat.mjs <answer.json>`

## 会社（数字は EDGAR の XBRL、提出されたまま）

### A — AGILENT TECHNOLOGIES, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 1,878 | 444 | 362 | 1.28 |
| 2026-04-30 | 1,835 | 399 | 339 | 1.2 |
| 2026-01-31 | 1,798 | 353 | 305 | 1.07 |
| 2025-07-31 | 1,738 | 360 | 336 | 1.18 |

直近の定期報告：10-Q（2026-09-01 提出）https://www.sec.gov/Archives/edgar/data/1090872/000109087226000064/a-20260731.htm
次の四半期末の目安：2026-10-31（会社の会計年度で確かめる）

### AA — Alcoa Corp

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 3,704 | — | 483 | 1.81 |
| 2026-06-30 | 3,966 | — | 407 | 1.53 |
| 2026-03-31 | 3,193 | — | 425 | 1.6 |
| 2025-09-30 | 2,995 | — | 232 | 0.88 |

直近の定期報告：10-Q（2026-10-29 提出）https://www.sec.gov/Archives/edgar/data/1675149/000119312526437885/aa-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AAL — American Airlines Group Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 16,335 | 115 | -269 | -0.41 |
| 2026-06-30 | 16,735 | 446 | 71 | 0.11 |
| 2026-03-31 | 13,912 | -41 | -382 | -0.58 |
| 2025-09-30 | 13,691 | 151 | -114 | -0.17 |

直近の定期報告：10-Q（2026-10-22 提出）https://www.sec.gov/Archives/edgar/data/6201/000000620126000065/aal-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AAOI — APPLIED OPTOELECTRONICS, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 269.9 | -1.4 | 6.3 | 0.07 |
| 2026-06-30 | 191.9 | -24.7 | -22.8 | -0.28 |
| 2026-03-31 | 151.1 | -13 | -14.3 | -0.19 |
| 2025-09-30 | 118.6 | -18.2 | -17.9 | -0.28 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1158114/000143774926035282/aaoi20260930_10q.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AAON — AAON, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | — | 100 | 69 | 0.83 |
| 2026-06-30 | — | 81.7 | 67.1 | 0.8 |
| 2026-03-31 | — | 52.3 | 36.5 | 0.44 |
| 2025-09-30 | — | 43.6 | 30.8 | 0.37 |

直近の定期報告：10-Q（2026-11-09 提出）https://www.sec.gov/Archives/edgar/data/824142/000082414226000088/aaon-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AAPL — Apple Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-06-27 | 109,417 | 35,695 | 29,789 | 2.02 |
| 2026-03-28 | 111,184 | 35,885 | 29,578 | 2.01 |
| 2025-12-27 | 143,756 | 50,852 | 42,097 | 2.84 |
| 2025-06-28 | 94,036 | 28,202 | 23,434 | 1.57 |

直近の通期（10-K）の期末：2026-09-26
直近の定期報告：10-K（2026-11-03 提出）https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ABBV — AbbVie Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 17,404 | 6,267 | 4,218 | 2.37 |
| 2026-06-30 | 16,990 | 6,432 | 3,613 | 2.03 |
| 2026-03-31 | 15,002 | 3,990 | 695 | 0.39 |
| 2025-12-31 | 16,618 | — | 1,816 | 1.02 |

直近の定期報告：10-Q（2026-11-03 提出）https://www.sec.gov/Archives/edgar/data/1551152/000155115226000037/abbv-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ABNB — Airbnb, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 4,869 | 2,021 | 1,890 | — |
| 2026-06-30 | 3,608 | 758 | 816 | — |
| 2026-03-31 | 2,678 | 86 | 160 | — |
| 2025-09-30 | 4,095 | 1,625 | 1,374 | — |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1559720/000155972026000032/abnb-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ABT — ABBOTT LABORATORIES

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 13,013 | 1,358 | 920 | 0.53 |
| 2026-06-30 | 12,593 | 1,693 | 928 | 0.53 |
| 2026-03-31 | 11,164 | 1,345 | 1,077 | 0.61 |
| 2025-09-30 | 11,369 | 2,057 | 1,644 | 0.94 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/1800/000162828026070154/abt-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACGL — ARCH CAPITAL GROUP LTD.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 4,655 | — | 1,035 | 3 |
| 2026-06-30 | 4,668 | — | 1,057 | 3 |
| 2026-03-31 | 4,521 | — | 1,047 | 2.88 |
| 2025-09-30 | 5,109 | — | 1,350 | 3.56 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/947484/000094748426000152/acgl-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACHR — Archer Aviation Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 5.1 | -289.2 | -274.5 | -0.35 |
| 2026-06-30 | 5 | -279.2 | -263.2 | -0.34 |
| 2026-03-31 | 1.6 | -254.6 | -217.7 | -0.28 |
| 2025-09-30 | 0 | -174.8 | -129.9 | -0.2 |

直近の定期報告：10-Q（2026-11-09 提出）https://www.sec.gov/Archives/edgar/data/1824502/000182450226000089/achr-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACI — Albertsons Companies, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-12 | 18,894.7 | 174.5 | 51.5 | 0.11 |
| 2025-11-29 | 19,123.7 | 489.7 | 293.3 | 0.55 |
| 2025-09-06 | 18,915.8 | 295.3 | 168.5 | 0.3 |
| 2024-11-30 | 18,774.5 | 518.5 | 400.6 | 0.69 |

次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACLS — AXCELIS TECHNOLOGIES INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 237.8 | 27.3 | 37.8 | 1.21 |
| 2026-06-30 | 215.2 | 20.3 | 23.3 | 0.75 |
| 2026-03-31 | 199 | 8 | 9.2 | 0.3 |
| 2025-09-30 | 213.6 | 25 | 26 | 0.83 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1113232/000110465926123333/acls-20260930x10q.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACM — AECOM

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-06-30 | 3,586.1 | -76 | -86.7 | -0.67 |
| 2026-03-31 | 3,801.1 | 247.8 | 179.9 | 1.39 |
| 2025-12-31 | 3,830.8 | 222 | 74.5 | 0.56 |
| 2025-06-30 | 4,178.4 | 294.1 | 131 | 0.98 |

直近の定期報告：10-Q（2026-08-11 提出）https://www.sec.gov/Archives/edgar/data/868857/000086885726000021/acm-20260703.htm
次の四半期末の目安：2026-09-30（会社の会計年度で確かめる）

### ACMR — ACM Research, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 367.7 | 55.5 | 1.5 | 0.02 |
| 2026-06-30 | 292.9 | 49.7 | 89 | 1.23 |
| 2026-03-31 | 231.3 | 36.2 | 17.3 | 0.24 |
| 2025-09-30 | 269.2 | 28.9 | 35.9 | 0.52 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1680062/000162828026071670/acmr-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ACN — Accenture plc

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-08-31 | 18,679.1 | 2,863.4 | 1,991.3 | 3.29 |
| 2026-05-31 | 18,718.1 | 3,175.3 | 2,339 | 3.8 |
| 2026-02-28 | 18,044.1 | 2,493.5 | 1,825.2 | 2.93 |
| 2025-11-30 | 18,742.1 | 2,873.7 | 2,211.6 | 3.54 |

直近の通期（10-K）の期末：2026-08-31
次の四半期末の目安：2026-11-30（会社の会計年度で確かめる）

### ADBE — ADOBE INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-08-28 | 6,760 | 2,354 | 1,827 | 4.62 |
| 2026-05-29 | 6,618 | 2,238 | 1,712 | 4.25 |
| 2026-02-27 | 6,398 | 2,418 | 1,889 | 4.6 |
| 2025-08-29 | 5,988 | 2,173 | 1,772 | 4.18 |

直近の定期報告：10-Q（2026-09-22 提出）https://www.sec.gov/Archives/edgar/data/796343/000079634326000156/adbe-20260828.htm
次の四半期末の目安：2026-11-30（会社の会計年度で確かめる）

### ADC — AGREE REALTY CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 213.9 | 109.6 | 68.4 | 0.53 |
| 2026-06-30 | 205.1 | 95.3 | 54.7 | 0.44 |
| 2026-03-31 | 200.8 | 98.6 | 62.1 | 0.5 |
| 2025-09-30 | 183.2 | 87.3 | 52.1 | 0.45 |

直近の定期報告：10-Q（2026-10-20 提出）https://www.sec.gov/Archives/edgar/data/917251/000091725126000076/adc-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ADI — ANALOG DEVICES INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-08-01 | 4,021.9 | 1,613 | 1,340.1 | 2.74 |
| 2026-05-02 | 3,623.5 | 1,379.7 | 1,176.4 | 2.4 |
| 2026-01-31 | 3,160.3 | 997 | 830.8 | 1.69 |
| 2025-08-02 | 2,880.3 | 818 | 518.5 | 1.04 |

次の四半期末の目安：2026-11-30（会社の会計年度で確かめる）

### ADM — Archer-Daniels-Midland Co

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 6,628 | — | 821 | 1.7 |
| 2026-06-30 | 6,386 | — | 908 | 1.87 |
| 2026-03-31 | 6,139 | — | 298 | 0.62 |
| 2025-09-30 | 6,416 | — | 108 | 0.22 |

直近の定期報告：10-Q（2026-11-03 提出）https://www.sec.gov/Archives/edgar/data/7084/000000708426000057/adm-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ADP — AUTOMATIC DATA PROCESSING INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 5,490.7 | — | 1,125.2 | 2.83 |
| 2026-03-31 | 5,939.2 | — | 1,359.8 | 3.38 |
| 2025-12-31 | 5,359.3 | — | 1,062 | 2.62 |
| 2025-09-30 | 5,175.2 | — | 1,013 | 2.49 |

次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ADSK — Autodesk, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 2,046 | 599 | 492 | 2.33 |
| 2026-04-30 | 1,934 | 541 | 491 | 2.32 |
| 2025-10-31 | 1,853 | 470 | 343 | 1.6 |
| 2025-07-31 | 1,763 | 444 | 313 | 1.46 |

直近の定期報告：10-Q（2026-08-28 提出）https://www.sec.gov/Archives/edgar/data/769397/000076939726000061/adsk-20260731.htm
次の四半期末の目安：2026-10-31（会社の会計年度で確かめる）

### ADT — ADT Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,349 | 310.5 | 150.6 | — |
| 2026-06-30 | 1,312.3 | 315.9 | 153.9 | — |
| 2026-03-31 | 1,278.5 | 325.4 | 168.4 | — |
| 2025-09-30 | 1,298 | 315.1 | 145.1 | — |

直近の定期報告：10-Q（2026-11-03 提出）https://www.sec.gov/Archives/edgar/data/1703056/000170305626000116/adt-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AEE — AMEREN CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-06-30 | 2,092 | 459 | — | 1.13 |
| 2026-03-31 | 2,176 | 532 | — | 1.28 |
| 2025-09-30 | 2,699 | 825 | — | 2.35 |
| 2025-06-30 | 2,221 | 411 | — | 1.01 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1002910/000100291026000032/aee-20260930.htm
次の四半期末の目安：2026-09-30（会社の会計年度で確かめる）

### AEHR — AEHR TEST SYSTEMS

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-25 | 33 | 6 | 7.2 | 0.21 |
| 2026-02-27 | 10.3 | -4.2 | -3.2 | -0.1 |
| 2025-11-28 | 9.9 | -4.6 | -3.2 | -0.11 |
| 2025-08-29 | 11 | -4.1 | -2.1 | -0.07 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1040470/000165495426009601/aehr_10q.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）
