export const DEPTHS = ["quick", "standard", "deep"] as const;
export type Depth = (typeof DEPTHS)[number];

export const PRICING_USD: Record<Depth, number> = {
  quick: 0.5,
  standard: 1.5,
  deep: 3.0,
};

export const TIME_ESTIMATE: Record<Depth, string> = {
  quick: "3-5 min",
  standard: "10-15 min",
  deep: "20-30 min",
};

export const CLAUDE_MODEL: Record<Depth, string> = {
  quick: "claude-sonnet-4-6",
  standard: "claude-sonnet-4-6",
  deep: "claude-opus-4-7",
};

export const SYSTEM_PROMPT = `あなたは機関投資家向けの投資分析メモ (IC memo) を作成するエージェントです。

ルール:
- Bull case と Bear case はいずれも steel-manned で書く (最も強い論理で書く)。
- 数値・主張は必ず引用元 URL や endpoint 名を示す (sources_called に集約)。
- 出力は厳密に JSON のみ。前後の文章や Markdown のコードフェンスは禁止。
- スキーマに存在しないフィールドは追加しない。
- 投資助言ではない旨を disclaimer に必ず含める。
- 数値は概算であり、実投資判断にはプロのアドバイザリーを推奨する旨を含める。
- xStocks は米英加豪EU 居住者制限あり。tokenized exposure に触れる場合は地域制限に言及する。
- 各自由記述フィールドは簡潔に。文章フィールドは指定した文数の範囲を守り、冗長な繰り返しを避ける (出力が長すぎると JSON が途中で切れるため)。

出力スキーマ:
{
  "ticker": "<UPPER>",
  "company_name": "<string>",
  "generated_at": "<ISO 8601 UTC>",
  "depth": "quick" | "standard" | "deep",
  "verdict": "BUY" | "HOLD" | "SELL" | "WATCH",
  "target_price_usd": <number>,
  "position_size_pct": <number 0-100>,
  "decision_card": {
    "summary": "<2-3 sentences>",
    "key_metrics": { "<label>": "<value>", ... }
  },
  "bull_case": "<3-6 sentences>",
  "bear_case": "<3-6 sentences>",
  "investment_thesis": [ { "point": "<string>", "supporting_data": "<string with source ref>" } ],
  "anti_thesis": [ { "point": "<string>", "supporting_data": "<string with source ref>" } ],
  "valuation": {
    "method_1": { "name": "<string>", "value_usd": <number>, "assumptions": "<string>" },
    "method_2": { "name": "<string>", "value_usd": <number>, "assumptions": "<string>" }
  },
  "top_risks": [ { "severity": <1-5>, "likelihood": <1-5>, "description": "<string>" } ],
  "decision_triggers": {
    "upgrade_if": [ "<string>", ... ],
    "downgrade_if": [ "<string>", ... ]
  },
  "sources_called": [ { "endpoint": "<string>", "cost_usd": <number>, "data_summary": "<string>" } ],
  "total_cost_usd": <number>,
  "disclaimer": "<string>"
}

target_price_usd は現在価格の 0.3-3.0 倍の範囲に収めること。
investment_thesis / anti_thesis はそれぞれ 3-5 項目。
top_risks は 3-5 項目。
position_size_pct は verdict が SELL なら 0、HOLD/WATCH なら 0-3、BUY なら 3-10 程度を目安とする。`;

export function userPromptFor({
  ticker,
  depth,
  aggregated,
}: {
  ticker: string;
  depth: Depth;
  aggregated: unknown;
}): string {
  return `対象銘柄: ${ticker.toUpperCase()}
分析 depth: ${depth}
生成時刻: ${new Date().toISOString()}

以下は内部 API から並列取得した raw データです。これを単一の IC memo に統合して、定義したスキーマ通りの JSON のみを返してください。

\`\`\`json
${JSON.stringify(aggregated, null, 2)}
\`\`\`

JSON のみを返す。前後の説明文 / コードフェンス禁止。`;
}

export interface AnalystOutput {
  ticker: string;
  company_name: string;
  generated_at: string;
  depth: Depth;
  verdict: "BUY" | "HOLD" | "SELL" | "WATCH";
  target_price_usd: number;
  position_size_pct: number;
  decision_card: {
    summary: string;
    key_metrics: Record<string, string | number>;
  };
  bull_case: string;
  bear_case: string;
  investment_thesis: Array<{ point: string; supporting_data: string }>;
  anti_thesis: Array<{ point: string; supporting_data: string }>;
  valuation: {
    method_1: { name: string; value_usd: number; assumptions: string };
    method_2: { name: string; value_usd: number; assumptions: string };
  };
  top_risks: Array<{
    severity: number;
    likelihood: number;
    description: string;
  }>;
  decision_triggers: {
    upgrade_if: string[];
    downgrade_if: string[];
  };
  sources_called: Array<{
    endpoint: string;
    cost_usd: number;
    data_summary: string;
  }>;
  total_cost_usd: number;
  disclaimer: string;
}

const REQUIRED_TOP_FIELDS: (keyof AnalystOutput)[] = [
  "ticker",
  "company_name",
  "generated_at",
  "depth",
  "verdict",
  "target_price_usd",
  "position_size_pct",
  "decision_card",
  "bull_case",
  "bear_case",
  "investment_thesis",
  "anti_thesis",
  "valuation",
  "top_risks",
  "decision_triggers",
  "sources_called",
  "total_cost_usd",
  "disclaimer",
];

export function validateAnalystOutput(
  raw: unknown,
  currentPriceUsd: number | undefined,
): { ok: true; value: AnalystOutput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "output is not an object" };
  }
  const o = raw as Record<string, unknown>;
  for (const k of REQUIRED_TOP_FIELDS) {
    if (!(k in o)) return { ok: false, error: `missing field: ${k}` };
  }
  if (typeof o.target_price_usd !== "number") {
    return { ok: false, error: "target_price_usd must be number" };
  }
  if (
    currentPriceUsd &&
    (o.target_price_usd < currentPriceUsd * 0.3 ||
      o.target_price_usd > currentPriceUsd * 3.0)
  ) {
    return {
      ok: false,
      error: `target_price_usd ${o.target_price_usd} out of range (current ${currentPriceUsd} × [0.3, 3.0])`,
    };
  }
  if (!["BUY", "HOLD", "SELL", "WATCH"].includes(o.verdict as string)) {
    return { ok: false, error: `invalid verdict: ${o.verdict}` };
  }
  return { ok: true, value: o as unknown as AnalystOutput };
}
