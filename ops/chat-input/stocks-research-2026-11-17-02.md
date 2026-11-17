# 米国株リサーチ 2026-11-17 — 第 2 回（25 社）

各社に、次に発表される四半期について **条件を 1 つ** 置く。判定は人もモデルも使わず、10-Q / 10-K の XBRL の数字と基準を機械的に比べる（scripts/judge-stocks-edgar.mjs）。

## 決まり

- metric は `revenue` / `operating_income` / `net_income` / `eps_diluted` のどれか 1 つ。ほかの数字（受注残・ARR・セグメント売上など）は使わない。
- threshold は、会社のガイダンス（決算発表・決算説明会・8-K）を根拠にする。ガイダンスがなければ、下の実績から根拠を書いて置く。根拠は basis に 1〜2 文、出どころの URL を source_url に。
- 単位：revenue / operating_income / net_income は **USD mn**（百万ドル）、eps_diluted は **USD per share**。
- fiscal_period / fiscal_year は会社の会計年度で書く。**Q4（10-K で報告される期）に eps_diluted は使えない**（10-K は通期しか載らず、EPS は引き算で出せない）。
- period_end はその四半期の末日。target_date は決算発表の予定日（会社が公表していれば confirmed、なければ過去の発表日から推定して estimated）。
- 条件を置けない会社（ガイダンスも実績もない、上場廃止の予定など）は items に入れない。無理に作らない。
- 表に第 4 四半期の行がないことがある：10-K は通期しか載せないため。判定では「通期 − 9 か月累計」で出す。

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

### AEIS — ADVANCED ENERGY INDUSTRIES INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 696.4 | 143.2 | — | 2.79 |
| 2026-06-30 | 574.1 | 95.1 | — | 1.28 |
| 2026-03-31 | 511 | 68.3 | — | 1.58 |
| 2025-09-30 | 463.3 | 49.2 | — | 1.2 |

直近の定期報告：10-Q（2026-11-02 提出）https://www.sec.gov/Archives/edgar/data/927003/000092700326000039/aeis-20260930x10q.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AEO — AMERICAN EAGLE OUTFITTERS INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-08-01 | 1,380.4 | 211.4 | 134.1 | 0.79 |
| 2026-05-02 | 1,195.3 | 28.2 | 23.5 | 0.14 |
| 2025-11-01 | 1,362.7 | 112.6 | 91.3 | 0.53 |
| 2025-08-02 | 1,283.7 | 103.1 | 77.6 | 0.45 |

次の四半期末の目安：2026-11-30（会社の会計年度で確かめる）

### AEP — AMERICAN ELECTRIC POWER CO INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-03-31 | 6,020 | 1,360 | — | 1.6 |
| 2025-09-30 | 6,010.4 | 1,521.4 | — | 1.81 |
| 2025-06-30 | 5,086.9 | 1,399.1 | — | 2.29 |
| 2025-03-31 | 5,463 | 1,284 | — | 1.5 |

直近の定期報告：10-Q（2026-10-28 提出）https://www.sec.gov/Archives/edgar/data/4904/000000490426000072/aep-20260930.htm
次の四半期末の目安：2026-06-30（会社の会計年度で確かめる）

### AES — AES CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 3,872 | — | 553 | 0.76 |
| 2026-06-30 | 3,422 | — | 426 | 0.6 |
| 2026-03-31 | 3,180 | — | 487 | 0.68 |
| 2025-09-30 | 3,351 | — | 639 | 0.89 |

直近の定期報告：10-Q（2026-11-03 提出）https://www.sec.gov/Archives/edgar/data/874761/000087476126000156/aes-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AFG — AMERICAN FINANCIAL GROUP INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 2,583 | 359 | 282 | 3.4 |
| 2026-06-30 | 2,030 | 316 | 248 | 2.99 |
| 2026-03-31 | 1,854 | 239 | 191 | 2.29 |
| 2025-09-30 | 2,331 | 268 | 215 | 2.58 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1042046/000104204626000033/afg-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AFL — AFLAC INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 3,271 | — | 303 | 0.61 |
| 2026-06-30 | 4,117 | — | 825 | 1.63 |
| 2026-03-31 | 4,346 | — | 1,019 | 1.98 |
| 2025-09-30 | 4,740 | — | 1,639 | 3.08 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/4977/000162828026070776/afl-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AFRM — Affirm Holdings, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,262.2 | 187.1 | 164.2 | 0.47 |
| 2026-03-31 | 1,038.8 | 88.4 | 102.9 | 0.3 |
| 2025-12-31 | 1,123 | 117.6 | 129.6 | 0.37 |
| 2025-09-30 | 933.3 | 63.7 | 80.7 | 0.23 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1820953/000162828026071153/afrm-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AG — FIRST MAJESTIC SILVER CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |

次の四半期末の目安：不明（EDGAR に四半期の期末がない。会社の開示で確かめる）

### AGCO — AGCO CORP /DE

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 2,262.5 | 116.1 | 51.7 | 0.75 |
| 2026-06-30 | 2,609.7 | 140.7 | 77.2 | 1.08 |
| 2026-03-31 | 2,342.9 | 80.7 | 55 | 0.76 |
| 2025-09-30 | 2,476.3 | 151.6 | 305.7 | 4.09 |

直近の定期報告：10-Q（2026-10-29 提出）https://www.sec.gov/Archives/edgar/data/880266/000088026626000077/agco-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AGNC — AGNC Investment Corp.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | — | — | -1,357 | -1.17 |
| 2026-06-30 | — | — | 654 | 0.52 |
| 2026-03-31 | — | — | -148 | -0.17 |
| 2025-09-30 | — | — | 806 | 0.72 |

直近の定期報告：10-Q（2026-10-29 提出）https://www.sec.gov/Archives/edgar/data/1423689/000142368926000148/agnc-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AGO — ASSURED GUARANTY LTD

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 214 | — | 78 | 1.75 |
| 2026-06-30 | 195 | — | 39 | 0.88 |
| 2026-03-31 | 261 | — | 88 | 1.91 |
| 2025-09-30 | 207 | — | 105 | 2.18 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1273813/000127381326000086/ago-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AHR — American Healthcare REIT, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 742.1 | 164.8 | 31.2 | 0.14 |
| 2026-06-30 | 674.3 | 137.2 | 30.6 | 0.16 |
| 2026-03-31 | 650.8 | 125.5 | 23.7 | 0.13 |
| 2025-09-30 | 572.9 | 105.8 | 55.9 | 0.33 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1632970/000119312526451865/ahr-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AI — C3.ai, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 52.4 | -98.3 | -92.8 | -0.6 |
| 2026-01-31 | 53.3 | -140.4 | -133.4 | -0.94 |
| 2025-10-31 | 75.1 | -112.1 | -104.7 | -0.75 |
| 2025-07-31 | 70.3 | -124.8 | -116.8 | -0.86 |

次の四半期末の目安：2026-10-31（会社の会計年度で確かめる）

### AIG — AMERICAN INTERNATIONAL GROUP, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 7,443 | — | — | 1.6 |
| 2026-06-30 | 7,085 | — | — | 1.78 |
| 2026-03-31 | 6,650 | — | — | 1.41 |
| 2025-09-30 | 6,351 | — | 519 | 0.93 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/5272/000000527226000104/aig-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AIP — Arteris, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 25.8 | -11.3 | -11.2 | -0.23 |
| 2026-06-30 | 24.1 | -13.9 | -14.1 | -0.3 |
| 2026-03-31 | 22.9 | -9.3 | -8 | -0.17 |
| 2025-09-30 | 17.4 | -8.7 | -9 | -0.21 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1667011/000162828026071154/aip-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AIT — APPLIED INDUSTRIAL TECHNOLOGIES INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,291.2 | 143.6 | 110.4 | 2.97 |
| 2026-03-31 | 1,251.5 | 137.9 | 99.8 | 2.65 |
| 2025-12-31 | 1,163 | 123.2 | 95.3 | 2.51 |
| 2025-09-30 | 1,199.5 | 129 | 100.8 | 2.63 |

直近の定期報告：10-Q（2026-10-27 提出）https://www.sec.gov/Archives/edgar/data/109563/000010956326000054/ait-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AIZ — ASSURANT, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 3,529.5 | — | 275.2 | 5.49 |
| 2026-06-30 | 3,454.2 | — | 298.6 | 5.95 |
| 2026-03-31 | 3,420.1 | — | 274.1 | 5.41 |
| 2025-09-30 | 3,231.5 | — | 265.6 | 5.17 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/1267238/000126723826000046/aiz-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AJG — Arthur J. Gallagher & Co.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 3,976 | — | 403 | 1.55 |
| 2026-06-30 | 4,003 | — | 324 | 1.25 |
| 2026-03-31 | 4,758 | — | 822 | 3.16 |
| 2025-09-30 | 3,365 | — | 272 | 1.04 |

直近の定期報告：10-Q（2026-11-05 提出）https://www.sec.gov/Archives/edgar/data/354190/000162828026070650/ajg-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### AKAM — AKAMAI TECHNOLOGIES INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,122 | 108.7 | 117.1 | 0.77 |
| 2026-06-30 | 1,099.7 | 80.3 | 79.4 | 0.52 |
| 2026-03-31 | 1,073.6 | 114.5 | 106.3 | 0.71 |
| 2025-09-30 | 1,054.6 | 166 | 140.2 | 0.97 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/1086222/000108622226000100/akam-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALAB — Astera Labs, Inc.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 584.9 | 179.1 | 182.9 | 0.99 |
| 2026-06-30 | 392.4 | 89.2 | 153.1 | 0.83 |
| 2026-03-31 | 308.4 | 61.8 | 80.3 | 0.44 |
| 2025-09-30 | 230.6 | 55.4 | 91.1 | 0.5 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/1736297/000173629726000045/alab-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALB — ALBEMARLE CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,553.1 | 148.2 | 296.8 | 2.15 |
| 2026-06-30 | 1,743.3 | 452.9 | 480 | 3.52 |
| 2026-03-31 | 1,428.7 | 233.5 | 319.1 | 2.34 |
| 2025-09-30 | 1,307.8 | -217 | -160.7 | -1.72 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/915913/000091591326000129/alb-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALGM — ALLEGRO MICROSYSTEMS, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-25 | 276.9 | 35.4 | 23.3 | 0.12 |
| 2026-06-26 | 259.2 | 25.5 | 15.9 | 0.08 |
| 2025-12-26 | 229.2 | 9.6 | 8.3 | 0.04 |
| 2025-09-26 | 214.3 | 6.2 | 6.5 | 0.03 |

直近の定期報告：10-Q（2026-10-30 提出）https://www.sec.gov/Archives/edgar/data/866291/000119312526439990/algm-20260925.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALGN — ALIGN TECHNOLOGY INC

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 1,014.8 | 169.2 | 135 | 1.9 |
| 2026-06-30 | 1,056.2 | 154 | 108.3 | 1.51 |
| 2026-03-31 | 1,040.1 | 142 | 112.8 | 1.57 |
| 2025-09-30 | 995.7 | 96.3 | 56.8 | 0.78 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/1097149/000109714926000081/algn-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALK — ALASKA AIR GROUP, INC.

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 4,308 | 82 | -147 | -1.32 |
| 2026-06-30 | 4,065 | -168 | -76 | -0.68 |
| 2026-03-31 | 3,300 | -279 | -193 | -1.69 |
| 2025-09-30 | 3,766 | 148 | 73 | 0.62 |

直近の定期報告：10-Q（2026-11-06 提出）https://www.sec.gov/Archives/edgar/data/766421/000076642126000049/alk-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）

### ALL — ALLSTATE CORP

| 四半期末 | Revenue (USD mn) | Operating income (USD mn) | Net income (USD mn) | Diluted EPS (USD) |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 17,348 | — | 2,079 | 8.03 |
| 2026-06-30 | 18,596 | — | 3,271 | 12.51 |
| 2026-03-31 | 16,941 | — | 2,457 | 9.25 |
| 2025-12-31 | 17,345 | — | — | 14.37 |

直近の定期報告：10-Q（2026-11-04 提出）https://www.sec.gov/Archives/edgar/data/899051/000089905126000157/all-20260930.htm
次の四半期末の目安：2026-12-31（会社の会計年度で確かめる）
