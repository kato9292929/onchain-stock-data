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

/** Theme label (display / prompt prose). */
export const JP_UNIVERSE_LABEL =
  "日本のAI・半導体・データセンター関連のサプライチェーン（半導体製造装置・材料・基板・電子部品・電力/冷却・サーバ/ネットワーク等）";

export interface JpUniverseItem {
  code: string; // 4-digit securities code
  name: string;
  segment: string;
}

/**
 * Selection universe — the SINGLE SOURCE OF TRUTH for JP tickers. The model is
 * shown this list and must pick codes from it; ticker + company_name are then
 * resolved back from here server-side (never from the model's free text). This
 * structurally prevents corrupted tickers (e.g. "6ARETURN") and out-of-universe
 * names from ever reaching holdings. Widen the theme by adding rows here.
 */
export const JP_UNIVERSE: JpUniverseItem[] = [
  { code: "8035", name: "東京エレクトロン", segment: "半導体製造装置" },
  { code: "6857", name: "アドバンテスト", segment: "半導体検査装置" },
  { code: "6146", name: "ディスコ", segment: "半導体製造装置" },
  { code: "6920", name: "レーザーテック", segment: "半導体検査装置" },
  { code: "7735", name: "SCREENホールディングス", segment: "半導体製造装置" },
  { code: "6323", name: "ローツェ", segment: "半導体搬送装置" },
  { code: "6525", name: "KOKUSAI ELECTRIC", segment: "半導体製造装置" },
  { code: "6728", name: "アルバック", segment: "半導体製造装置" },
  { code: "7729", name: "東京精密", segment: "半導体製造装置" },
  { code: "6590", name: "芝浦メカトロニクス", segment: "半導体製造装置" },
  { code: "4063", name: "信越化学工業", segment: "半導体材料" },
  { code: "3436", name: "SUMCO", segment: "半導体材料（シリコンウェハ）" },
  { code: "4186", name: "東京応化工業", segment: "半導体材料" },
  { code: "4004", name: "レゾナック・ホールディングス", segment: "半導体材料" },
  { code: "3110", name: "日東紡績", segment: "電子材料（ガラスクロス）" },
  { code: "2802", name: "味の素", segment: "電子材料（ABF）" },
  { code: "5334", name: "日本特殊陶業", segment: "電子部品・セラミック" },
  { code: "4062", name: "イビデン", segment: "基板・パッケージ" },
  { code: "6967", name: "新光電気工業", segment: "基板・パッケージ" },
  { code: "6787", name: "メイコー", segment: "プリント基板" },
  { code: "6762", name: "TDK", segment: "電子部品" },
  { code: "6981", name: "村田製作所", segment: "電子部品" },
  { code: "6976", name: "太陽誘電", segment: "電子部品" },
  { code: "6971", name: "京セラ", segment: "電子部品・パッケージ" },
  { code: "6806", name: "ヒロセ電機", segment: "コネクタ" },
  { code: "6807", name: "日本航空電子工業", segment: "コネクタ" },
  { code: "6723", name: "ルネサスエレクトロニクス", segment: "半導体（ロジック）" },
  { code: "6963", name: "ローム", segment: "半導体（パワー）" },
  { code: "6707", name: "サンケン電気", segment: "半導体（パワー）" },
  { code: "6504", name: "富士電機", segment: "パワー半導体・電力" },
  { code: "6594", name: "ニデック", segment: "モーター・冷却" },
  { code: "6273", name: "SMC", segment: "制御機器" },
  { code: "6701", name: "NEC", segment: "IT・サーバ" },
  { code: "6702", name: "富士通", segment: "IT・サーバ" },
  { code: "6754", name: "アンリツ", segment: "計測・通信" },
  { code: "7741", name: "HOYA", segment: "フォトマスク・材料" },
];

const JP_UNIVERSE_BY_CODE = new Map(JP_UNIVERSE.map((u) => [u.code, u]));
const JP_UNIVERSE_LINES = JP_UNIVERSE.map(
  (u) => `${u.code} ${u.name}（${u.segment}）`,
).join("\n");

const SYSTEM_PROMPT = `あなたは日本株のロング・オンリー・ポートフォリオを構築するエージェントです。1 ヶ月先を見据えて、最もキレのある ${PORTFOLIO_SIZE} 銘柄を選びます。

選定ユニバースは ${JP_UNIVERSE_LABEL} です。必ず次の候補リストの中からのみ ${PORTFOLIO_SIZE} 銘柄を選びます。リストに無い銘柄・コードは絶対に出さないでください。

候補リスト（証券コード 社名（セグメント））:
${JP_UNIVERSE_LINES}

ルール:
- 上の候補リストから ${PORTFOLIO_SIZE} 銘柄ちょうどを選ぶ。ticker には候補リストの4桁コードをそのまま入れる（例 "4062"）。コードを創作・変形しない。
- 「対象外」「除外」など、選ばない理由の銘柄を holdings に入れてはいけない。10 枠すべてを候補リスト内の選ぶ銘柄で埋める。
- コンセンサスと違う見方を歓迎する。無難に大型株だけを並べる構成は避ける。
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
    { "ticker": "<候補リストの4桁コード>", "company_name": "<string>", "weight": <number>, "thesis": "<1 文 (日本語): 1 ヶ月の検証可能な数値・期日つき catalyst>", "target_date": "<YYYY-MM-DD>" }
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

  const raw = parsed.holdings as Array<Record<string, unknown>>;
  // Log the model's raw tickers so a future corruption is visible in CI logs.
  console.log(
    `[jp-select] raw tickers: ${raw.map((h) => String(h.ticker ?? "")).join(", ")}`,
  );

  const holdings = resolveJpHoldings(raw);
  if (holdings.length === 0) {
    return { ok: false, error: "no valid holdings after resolve" };
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
 * Resolve a model's raw holdings into clean, universe-backed holdings.
 *
 * For each row: the ticker must be a code present in JP_UNIVERSE; the
 * company_name is taken from the universe (the model's free text is ignored —
 * this is what fixes the "6ARETURN" corruption). Out-of-universe codes,
 * duplicates, "対象外/除外" rows and bad weights are dropped (logged). If fewer
 * than PORTFOLIO_SIZE survive, the remainder is filled from the universe so the
 * result is always exactly PORTFOLIO_SIZE, all 4-digit, all in-universe.
 */
export function resolveJpHoldings(
  raw: Array<Record<string, unknown>>,
): JpPortfolioHolding[] {
  const seen = new Set<string>();
  const out: JpPortfolioHolding[] = [];
  const notes: string[] = [];

  for (const h of raw) {
    if (out.length >= PORTFOLIO_SIZE) break;
    const code = String(h.ticker ?? "").trim();
    const uni = JP_UNIVERSE_BY_CODE.get(code);
    if (!uni) {
      notes.push(`${code || "(空)"}:not-in-universe`);
      continue;
    }
    if (seen.has(code)) {
      notes.push(`${code}:dup`);
      continue;
    }
    const thesis = String(h.thesis ?? "").trim();
    if (/対象外|除外/.test(thesis)) {
      seen.add(code);
      notes.push(`${code}:excluded-thesis`);
      continue;
    }
    const w = Number(h.weight);
    if (!Number.isFinite(w) || w <= 0) {
      seen.add(code);
      notes.push(`${code}:bad-weight`);
      continue;
    }
    seen.add(code);
    out.push({
      ticker: code,
      company_name: uni.name, // resolved from the universe, not the model text
      weight: w,
      thesis,
      target_date: normalizeDate(h.target_date),
    });
  }

  // Fill any shortfall from the universe so holdings is always exactly full.
  if (out.length < PORTFOLIO_SIZE) {
    const valid = out.map((h) => h.weight);
    const fillWeight = valid.length
      ? valid.reduce((s, w) => s + w, 0) / valid.length
      : 10;
    for (const u of JP_UNIVERSE) {
      if (out.length >= PORTFOLIO_SIZE) break;
      if (seen.has(u.code)) continue;
      seen.add(u.code);
      out.push({
        ticker: u.code,
        company_name: u.name,
        weight: fillWeight,
        thesis: "（ユニバース内・自動補填、catalyst 未設定）",
        target_date: "",
      });
      notes.push(`fill:${u.code}`);
    }
  }

  if (notes.length) {
    console.warn(
      `[jp-select] resolved ${out.length}/${PORTFOLIO_SIZE}; dropped/filled: ${notes.join(", ")}`,
    );
  }
  return normalizeJpWeights(out).slice(0, PORTFOLIO_SIZE);
}

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
