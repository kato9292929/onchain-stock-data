import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PORTFOLIO_MODEL } from "@/lib/portfolio";
import type {
  JpPortfolio,
  JpPortfolioHolding,
  JpPortfolioHistoryFile,
  PortfolioChange,
} from "@/lib/data";

/**
 * Weekly JP "Claude Portfolio": Claude selects 10 Japanese equities with
 * weights + a verifiable 1-month dated catalyst thesis (in Japanese). Mirrors
 * lib/portfolio.ts (US) but is fully separate: own file, own endpoint, own
 * universe constraint. Persisted to data/jp-portfolio-history.json (git-
 * committed). No onchain/liquidity enrichment, no AA, no Upstash.
 */

export const PORTFOLIO_SIZE = 10;
export { PORTFOLIO_MODEL };

/**
 * Selection universe, kept as a constant so it can be widened later without
 * touching the prompt body. For now: Japan's AI / semiconductor / data-center
 * supply chain — the theme where decision-grade, earnings-based scoring is most
 * stable.
 */
export const JP_UNIVERSE =
  "日本のAI・半導体・データセンター関連のサプライチェーン（半導体製造装置・材料・基板・電子部品・電力/冷却・サーバ/ネットワーク等）";

const SYSTEM_PROMPT = `あなたは日本株のロング・オンリー・ポートフォリオを構築するエージェントです。1 ヶ月先を見据えて、最もキレのある ${PORTFOLIO_SIZE} 銘柄を選びます。

ルール:
- 選定ユニバースは ${JP_UNIVERSE} に限定する。このテーマ内から ${PORTFOLIO_SIZE} 銘柄を選ぶ。
- 各銘柄は東京証券取引所などに上場する日本株。ticker は4桁の証券コード（例 "4062"）。
- コンセンサスと違う見方を歓迎する。誰でも挙げる大型株を並べるだけの無難な構成は避ける。
- weight は合計 100 になるよう配分する（各 4〜20 の範囲目安）。
- 各銘柄の thesis は「今後 1 ヶ月で何が起きれば当たりか」を 1 行で言える、検証可能な catalyst にする。数値・期日つきにすること。
  例: 「8/5 の第1四半期決算で電子事業が前年同期比+20%超の増収なら再評価」「7月の月次受注で…」。
  「成長が続く」「ブランドが強い」のような曖昧で検証不能な理由は禁止。
- target_date は、その catalyst を判定する基準日（多くは次回決算の予想日）を YYYY-MM-DD で書く。正式日程が未公表なら過去の発表時期からの予想でよい。
- thesis と rationale は日本語で書く。
- 出力は厳密に JSON のみ。前後の文章や Markdown コードフェンス禁止。スキーマに無いフィールドを足さない。
- これは投資助言ではなく情報提供。

出力スキーマ:
{
  "rationale": "<2-4 文 (日本語): 今週の全体方針・どこにエッジを置いたか>",
  "holdings": [
    { "ticker": "<4桁コード>", "company_name": "<string>", "weight": <number>, "thesis": "<1 文 (日本語): 1 ヶ月の検証可能な数値・期日つき catalyst>", "target_date": "<YYYY-MM-DD>" }
  ]
}`;

export interface SelectJpPortfolioInput {
  weekOf: string;
  horizon: string;
  /** Previous week's portfolio, so Claude can carry conviction / track changes. */
  previous?: JpPortfolio | null;
}

export async function selectJpPortfolio(
  input: SelectJpPortfolioInput,
): Promise<{ ok: true; portfolio: JpPortfolio } | { ok: false; error: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set" };

  const client = new Anthropic({ apiKey, timeout: 300_000 });

  const previousBlock = input.previous
    ? `\n\n前週のポートフォリオ (継続/入替の判断材料・無理に変えなくてよい):
\`\`\`json
${JSON.stringify(
  {
    week_of: input.previous.week_of,
    holdings: input.previous.holdings.map((h) => ({
      ticker: h.ticker,
      weight: h.weight,
    })),
  },
  null,
  2,
)}
\`\`\``
    : "\n\n前週のポートフォリオはありません (初回選定)。";

  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create({
      model: PORTFOLIO_MODEL,
      // JP rows carry an extra target_date and longer Japanese theses; give the
      // model enough room so the 10-holding JSON never truncates mid-output
      // (a too-small budget previously corrupted later tickers).
      max_tokens: 4_096,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `週: ${input.weekOf}
horizon: ${input.horizon}
生成時刻: ${new Date().toISOString()}
${previousBlock}

${PORTFOLIO_SIZE} 銘柄のポートフォリオを選定し、スキーマ通りの JSON のみを返してください。`,
        },
      ],
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  let parsed: { rationale?: unknown; holdings?: unknown };
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch (e) {
    return { ok: false, error: `Claude returned non-JSON: ${(e as Error).message}` };
  }

  if (!Array.isArray(parsed.holdings) || parsed.holdings.length === 0) {
    return { ok: false, error: "holdings missing or empty" };
  }

  const holdings = normalizeJpWeights(
    (parsed.holdings as Record<string, unknown>[]).map((h) => ({
      ticker: String(h.ticker ?? "").toUpperCase(),
      company_name: String(h.company_name ?? h.ticker ?? ""),
      weight: Number(h.weight ?? 0),
      thesis: String(h.thesis ?? ""),
      target_date: normalizeDate(h.target_date),
    })),
  );
  if (holdings.length === 0) {
    return { ok: false, error: "no valid holdings after normalization" };
  }

  return {
    ok: true,
    portfolio: {
      week_of: input.weekOf,
      generated_at: new Date().toISOString(),
      model: PORTFOLIO_MODEL,
      horizon: input.horizon,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      holdings,
    },
  };
}

/** Keep only YYYY-MM-DD; anything else becomes "" (the judge skips empty). */
function normalizeDate(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** A valid JP securities code is 4 digits (e.g. "4062"). */
export const JP_TICKER_RE = /^\d{4}$/;

/**
 * Drop invalid rows and scale weights so they sum to 100 (rounded to 0.1).
 * Rows whose ticker is not a 4-digit code are dropped — this guards against a
 * corrupted/truncated model response leaking garbage tickers into the holdings.
 */
export function normalizeJpWeights(
  holdings: JpPortfolioHolding[],
): JpPortfolioHolding[] {
  const valid = holdings.filter(
    (h) => JP_TICKER_RE.test(h.ticker) && Number.isFinite(h.weight) && h.weight > 0,
  );
  const total = valid.reduce((s, h) => s + h.weight, 0);
  if (total <= 0) return [];
  return valid.map((h) => ({
    ...h,
    weight: Math.round((h.weight / total) * 1000) / 10,
  }));
}

/** Week-over-week change set (mirror of the US diffHoldings). */
export function diffJpHoldings(
  prev: JpPortfolio | null | undefined,
  next: JpPortfolio,
): PortfolioChange[] {
  const prevMap = new Map((prev?.holdings ?? []).map((h) => [h.ticker, h.weight]));
  const nextMap = new Map(next.holdings.map((h) => [h.ticker, h.weight]));
  const changes: PortfolioChange[] = [];
  for (const h of next.holdings) {
    const before = prevMap.get(h.ticker);
    if (before === undefined) {
      changes.push({ ticker: h.ticker, action: "add", to_weight: h.weight });
    } else if (h.weight > before + 0.05) {
      changes.push({ ticker: h.ticker, action: "increase", from_weight: before, to_weight: h.weight });
    } else if (h.weight < before - 0.05) {
      changes.push({ ticker: h.ticker, action: "decrease", from_weight: before, to_weight: h.weight });
    } else {
      changes.push({ ticker: h.ticker, action: "hold", from_weight: before, to_weight: h.weight });
    }
  }
  for (const [ticker, weight] of prevMap) {
    if (!nextMap.has(ticker)) {
      changes.push({ ticker, action: "remove", from_weight: weight });
    }
  }
  return changes;
}

export function appendJpPortfolio(
  prev: JpPortfolioHistoryFile,
  next: JpPortfolio,
): JpPortfolioHistoryFile {
  const history = prev.current ? [prev.current, ...prev.history] : prev.history;
  return {
    source: "claude-jp-portfolio",
    note: "Weekly Claude-selected Japanese-equity portfolio (AI / semiconductor / data-center supply chain). Generated by scripts/update-jp-portfolio.ts and committed to git. Not investment advice.",
    updated_at: new Date().toISOString(),
    current: next,
    history,
  };
}

const DATA_DIR = path.join(process.cwd(), "data");

export async function writeJpPortfolioHistory(
  file: JpPortfolioHistoryFile,
): Promise<{ persisted: boolean; reason?: string }> {
  try {
    await fs.writeFile(
      path.join(DATA_DIR, "jp-portfolio-history.json"),
      JSON.stringify(file, null, 2) + "\n",
    );
    return { persisted: true };
  } catch (e) {
    return { persisted: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/, "").trim();
  }
  return t;
}
