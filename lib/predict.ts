import Anthropic from "@anthropic-ai/sdk";
import { getStockByTicker, getLiquidity } from "@/lib/data";
import { aggregateForTicker } from "@/lib/analyst/data-aggregator";

/**
 * /api/predict core logic.
 *
 * Claude synthesises a buy/hold/sell call per ticker from osd's own data
 * sources. To avoid N+1 recursive Claude calls (which would blow Vercel
 * function timeouts), predict feeds the same aggregated internal data the
 * analyst uses (`aggregateForTicker`) plus, on `deep`, Nansen Smart Money,
 * into a SINGLE synthesis call — rather than generating a full IC memo per
 * ticker and then re-synthesising.
 *
 * Data per depth:
 *   quick    — price / 24h volume (getStockByTicker)
 *   standard — + DEX liquidity (getLiquidity) + cross-market context
 *              (aggregateForTicker: stocks/ipo/liquidity/holders/alpha)
 *   deep     — + Nansen Smart Money screener (SMART_MONEY_URL)
 */

export const PREDICT_DEPTHS = ["quick", "standard", "deep"] as const;
export type PredictDepth = (typeof PREDICT_DEPTHS)[number];

export const PREDICT_HORIZONS = ["1w", "1m", "3m"] as const;
export type PredictHorizon = (typeof PREDICT_HORIZONS)[number];

export const PREDICT_PRICING_USD: Record<PredictDepth, number> = {
  quick: 0.5,
  standard: 1.5,
  deep: 3.0,
};

export const PREDICT_MAX_TICKERS: Record<PredictDepth, number> = {
  quick: 5,
  standard: 10,
  deep: 10,
};

// deep uses the flagship Opus model (per spec); quick/standard use Sonnet to
// keep latency and cost proportional to the price tier.
export const PREDICT_MODEL: Record<PredictDepth, string> = {
  quick: "claude-sonnet-4-6",
  standard: "claude-sonnet-4-6",
  deep: "claude-opus-4-7",
};

const MAX_TOKENS: Record<PredictDepth, number> = {
  quick: 2_000,
  standard: 4_000,
  deep: 6_000,
};

const TIMEOUT_MS: Record<PredictDepth, number> = {
  quick: 60_000,
  standard: 180_000,
  deep: 300_000,
};

export interface PredictItem {
  ticker: string;
  company_name: string;
  predict: "buy" | "hold" | "sell";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  data_summary: string;
  current_price_usd: number | null;
  target_price_usd: number | null;
}

export interface PredictResult {
  horizon: PredictHorizon;
  depth: PredictDepth;
  generated_at: string;
  model: string;
  predictions: PredictItem[];
  portfolio_note: string;
  sources_called: Array<{
    endpoint: string;
    cost_usd: number;
    data_summary: string;
  }>;
  total_cost_usd: number;
  disclaimer: string;
}

export interface PredictError {
  kind: "missing_api_key" | "claude_error" | "invalid_output" | "timeout";
  message: string;
  raw?: string;
}

const SYSTEM_PROMPT = `あなたは米国株のショート〜ミドルタームの方向性を予測するエージェントです。

ルール:
- 各銘柄について buy / hold / sell のいずれかと、confidence (low / medium / high) を出す。
- 判断は与えられた raw データ (価格・出来高・DEX 流動性・cross-market context・Smart Money) のみに基づく。データに無い主張をしない。
- reasoning は 2-4 文。data_summary は使ったデータの要点を 1-2 文で。
- 出力は厳密に JSON のみ。前後の文章や Markdown コードフェンスは禁止。スキーマに無いフィールドを足さない。
- これは投資助言ではない旨を disclaimer に必ず含める。
- xStocks は米英加豪EU 居住者制限あり。tokenized exposure に触れる場合は地域制限に言及する。
- target_price_usd は horizon 終端の目安。算定できなければ null。current_price_usd の 0.3〜3.0 倍に収める。

出力スキーマ:
{
  "horizon": "1w" | "1m" | "3m",
  "depth": "quick" | "standard" | "deep",
  "generated_at": "<ISO 8601 UTC>",
  "predictions": [
    {
      "ticker": "<UPPER>",
      "company_name": "<string>",
      "predict": "buy" | "hold" | "sell",
      "confidence": "low" | "medium" | "high",
      "reasoning": "<2-4 sentences>",
      "data_summary": "<1-2 sentences>",
      "current_price_usd": <number|null>,
      "target_price_usd": <number|null>
    }
  ],
  "portfolio_note": "<1-3 sentences: 全体の組み合わせに対する所見>",
  "disclaimer": "<string>"
}

predictions は要求された全 ticker をこの順で 1 件ずつ含めること。`;

interface GatheredTicker {
  ticker: string;
  company_name: string;
  current_price_usd: number | null;
  found: boolean;
  stock: unknown;
  liquidity: unknown;
  cross_market: unknown;
}

async function gatherTicker(
  ticker: string,
  depth: PredictDepth,
): Promise<GatheredTicker> {
  const upper = ticker.toUpperCase();
  const stock = await getStockByTicker(upper).catch(() => null);

  let liquidity: unknown = null;
  let cross_market: unknown = null;
  if (depth === "standard" || depth === "deep") {
    liquidity = await getLiquidity(upper).catch(() => null);
    const agg = await aggregateForTicker(upper).catch(() => null);
    cross_market = agg
      ? {
          ipo_record: agg.ipo_record,
          holders_for_ticker: agg.holders_for_ticker,
          cross_market_context: agg.cross_market_context,
        }
      : null;
  }

  return {
    ticker: upper,
    company_name: stock?.company_name ?? upper,
    current_price_usd: stock?.price_usd ?? null,
    found: Boolean(stock),
    stock,
    liquidity,
    cross_market,
  };
}

async function fetchSmartMoney(
  tickers: string[],
): Promise<unknown> {
  const url = process.env.SMART_MONEY_URL;
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `${url}${url.includes("?") ? "&" : "?"}tickers=${encodeURIComponent(tickers.join(","))}`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) {
      console.warn(`[predict] smart money ${res.status} from ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("[predict] smart money fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runPredict(input: {
  tickers: string[];
  horizon: PredictHorizon;
  depth: PredictDepth;
  internalAuthed: boolean;
}): Promise<
  { ok: true; result: PredictResult } | { ok: false; err: PredictError }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      err: {
        kind: "missing_api_key",
        message:
          "ANTHROPIC_API_KEY is not set. Configure it in the runtime environment (Vercel / .env.local).",
      },
    };
  }

  const { tickers, horizon, depth } = input;

  const gathered = await Promise.all(
    tickers.map((t) => gatherTicker(t, depth)),
  );
  const smartMoney =
    depth === "deep" ? await fetchSmartMoney(tickers) : null;

  const sources_called: PredictResult["sources_called"] = [
    {
      endpoint: "/api/stocks/:ticker",
      cost_usd: 0,
      data_summary: "price / 24h volume per ticker (same-host internal call)",
    },
  ];
  if (depth === "standard" || depth === "deep") {
    sources_called.push(
      {
        endpoint: "/api/liquidity",
        cost_usd: 0,
        data_summary: "tokens.xyz DEX liquidity ranking per ticker",
      },
      {
        endpoint: "/api/stocks,/api/ipo,/api/holders,/api/alpha-posts",
        cost_usd: 0,
        data_summary: "cross-market context (aggregated)",
      },
    );
  }
  if (depth === "deep") {
    sources_called.push({
      endpoint: process.env.SMART_MONEY_URL ?? "SMART_MONEY_URL",
      cost_usd: 0,
      data_summary: smartMoney
        ? "Nansen Smart Money positioning"
        : "Smart Money unavailable (skipped)",
    });
  }

  const promptPayload = {
    request: { tickers: tickers.map((t) => t.toUpperCase()), horizon, depth },
    tickers: gathered.map((g) => ({
      ticker: g.ticker,
      company_name: g.company_name,
      current_price_usd: g.current_price_usd,
      found: g.found,
      stock: g.stock,
      liquidity: g.liquidity,
      cross_market: g.cross_market,
    })),
    smart_money: smartMoney,
  };

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS[depth] });

  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create({
      model: PREDICT_MODEL[depth],
      max_tokens: MAX_TOKENS[depth],
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `予測対象: ${tickers.map((t) => t.toUpperCase()).join(", ")}
horizon: ${horizon}
depth: ${depth}
生成時刻: ${new Date().toISOString()}

以下は osd 内部から取得した raw データです。これを統合し、定義したスキーマ通りの JSON のみを返してください。

\`\`\`json
${JSON.stringify(promptPayload, null, 2)}
\`\`\`

JSON のみ。前後の説明文 / コードフェンス禁止。`,
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = msg.toLowerCase().includes("timeout") ? "timeout" : "claude_error";
    return { ok: false, err: { kind, message: msg } };
  }

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const jsonText = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return {
      ok: false,
      err: {
        kind: "invalid_output",
        message: `Claude returned non-JSON: ${(e as Error).message}`,
        raw: text.slice(0, 2000),
      },
    };
  }

  const validation = validatePredictOutput(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      err: { kind: "invalid_output", message: validation.error, raw: jsonText.slice(0, 2000) },
    };
  }

  const result = validation.value;
  result.horizon = horizon;
  result.depth = depth;
  result.generated_at = result.generated_at || new Date().toISOString();
  result.model = PREDICT_MODEL[depth];
  result.sources_called = sources_called;
  result.total_cost_usd = input.internalAuthed ? 0 : PREDICT_PRICING_USD[depth];
  if (!result.disclaimer) {
    result.disclaimer =
      "本予測は Claude による情報提供であり投資助言ではありません。実投資判断は各自の責任で行ってください。";
  }

  return { ok: true, result };
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/, "").trim();
  }
  return t;
}

function validatePredictOutput(
  raw: unknown,
): { ok: true; value: PredictResult } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "output is not an object" };
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.predictions)) {
    return { ok: false, error: "predictions must be an array" };
  }
  for (const [i, p] of (o.predictions as unknown[]).entries()) {
    if (!p || typeof p !== "object") {
      return { ok: false, error: `predictions[${i}] is not an object` };
    }
    const item = p as Record<string, unknown>;
    if (typeof item.ticker !== "string") {
      return { ok: false, error: `predictions[${i}].ticker missing` };
    }
    if (!["buy", "hold", "sell"].includes(item.predict as string)) {
      return { ok: false, error: `predictions[${i}].predict invalid: ${item.predict}` };
    }
    if (!["low", "medium", "high"].includes(item.confidence as string)) {
      return { ok: false, error: `predictions[${i}].confidence invalid: ${item.confidence}` };
    }
    if (item.current_price_usd === undefined) item.current_price_usd = null;
    if (item.target_price_usd === undefined) item.target_price_usd = null;
    if (typeof item.data_summary !== "string") item.data_summary = "";
    if (typeof item.company_name !== "string") item.company_name = item.ticker;
  }
  if (typeof o.portfolio_note !== "string") o.portfolio_note = "";
  return { ok: true, value: o as unknown as PredictResult };
}
