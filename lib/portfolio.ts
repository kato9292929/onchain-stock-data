import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Portfolio,
  PortfolioHolding,
  PortfolioChange,
  PortfolioHistoryFile,
} from "@/lib/data";

/**
 * Weekly "Claude Portfolio": Claude selects 10 US stocks (no large-cap /
 * liquidity constraint) with weights + a verifiable 1-month catalyst thesis
 * (in Japanese). Used by the weekly job and persisted to
 * data/portfolio-history.json (committed to git for transparency).
 * Onchain/tokenized status does NOT influence selection — it is surfaced
 * only as page enrichment (badge + links) on holdings that have an xStock.
 */

export const PORTFOLIO_SIZE = 10;
export const PORTFOLIO_MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `あなたは米国株のロング・オンリー・ポートフォリオを構築するエージェントです。1 ヶ月先を見据えて、最もキレのある ${PORTFOLIO_SIZE} 銘柄を選びます。

ルール:
- 米国上場株から ${PORTFOLIO_SIZE} 銘柄を選ぶ。「大型株」「高流動性」という縛りはない。中小型株・カバレッジの薄い銘柄を入れてよい。
- コンセンサスと違う見方を歓迎する。誰でも挙げる大型株を並べるだけの無難な構成は避ける。
- weight は合計 100 になるよう配分する (各 4〜20 の範囲目安)。
- 各銘柄の thesis は「今後 1 ヶ月で何が起きれば当たりか」を 1 行で言える、検証可能な catalyst にする。
  例: 「X/X の決算でデータセンタ受注が前四半期比+20%を超えれば再評価」「FDA の承認判断 (X月) で…」。
  「durable growth」「強いブランド」「粘着性が高い」のような曖昧で検証不能な理由は禁止。
- thesis と rationale は日本語で書く。
- 出力は厳密に JSON のみ。前後の文章や Markdown コードフェンス禁止。スキーマに無いフィールドを足さない。
- これは投資助言ではなく情報提供。

出力スキーマ:
{
  "rationale": "<2-4 文 (日本語): 今週の全体方針・どこにエッジを置いたか>",
  "holdings": [
    { "ticker": "<UPPER>", "company_name": "<string>", "weight": <number>, "thesis": "<1 文 (日本語): 1 ヶ月の検証可能な catalyst>" }
  ]
}`;

export interface SelectPortfolioInput {
  weekOf: string;
  horizon: string;
  /** Previous week's portfolio, so Claude can carry conviction / track changes. */
  previous?: Portfolio | null;
}

export async function selectPortfolio(
  input: SelectPortfolioInput,
): Promise<
  { ok: true; portfolio: Portfolio } | { ok: false; error: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set" };

  const client = new Anthropic({ apiKey, timeout: 300_000 });

  // Port from Claude-Stock-Portfolio-Watch: feed previous holdings so the
  // model can keep conviction names and justify rotations week over week.
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
      max_tokens: 3_000,
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

  const holdings = normalizeWeights(
    (parsed.holdings as Record<string, unknown>[]).map((h) => ({
      ticker: String(h.ticker ?? "").toUpperCase(),
      company_name: String(h.company_name ?? h.ticker ?? ""),
      weight: Number(h.weight ?? 0),
      thesis: String(h.thesis ?? ""),
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

/** Drop invalid rows and scale weights so they sum to 100 (rounded to 0.1). */
export function normalizeWeights(
  holdings: PortfolioHolding[],
): PortfolioHolding[] {
  const valid = holdings.filter(
    (h) => h.ticker && Number.isFinite(h.weight) && h.weight > 0,
  );
  const total = valid.reduce((s, h) => s + h.weight, 0);
  if (total <= 0) return [];
  return valid.map((h) => ({
    ...h,
    weight: Math.round((h.weight / total) * 1000) / 10,
  }));
}

/**
 * Week-over-week change set (added / removed / weight increase|decrease|hold).
 * Ported from Claude-Stock-Portfolio-Watch's change tracking — drives the
 * color-coded timeline on /alpha/portfolio/history.
 */
export function diffHoldings(
  prev: Portfolio | null | undefined,
  next: Portfolio,
): PortfolioChange[] {
  const prevMap = new Map(
    (prev?.holdings ?? []).map((h) => [h.ticker, h.weight]),
  );
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

/** Build the next history file: previous current rotates into history. */
export function appendPortfolio(
  prev: PortfolioHistoryFile,
  next: Portfolio,
): PortfolioHistoryFile {
  const history = prev.current ? [prev.current, ...prev.history] : prev.history;
  return {
    source: "claude-portfolio",
    note: "Weekly Claude-selected US equity portfolio. Generated by /api/cron/update-portfolio and committed to git. Not investment advice.",
    updated_at: new Date().toISOString(),
    current: next,
    history,
  };
}

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * Best-effort persistence. On Vercel the filesystem is read-only outside
 * /tmp, so a failed write is not fatal — the caller still returns the
 * computed portfolio so an external workflow (GitHub Action) can commit it.
 */
export async function writePortfolioHistory(
  file: PortfolioHistoryFile,
): Promise<{ persisted: boolean; reason?: string }> {
  try {
    await fs.writeFile(
      path.join(DATA_DIR, "portfolio-history.json"),
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
