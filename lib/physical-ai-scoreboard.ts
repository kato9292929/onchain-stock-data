import type { EvaluationStatus, ExternalCatalyst } from "./data";

/**
 * Shared scoreboard logic for the editorial "Physical AI" series dated
 * catalysts, used by BOTH the free web page (/catalysts) and the free JSON API
 * (/api/alpha/catalysts/physical-ai) so the two never drift. Presentation
 * (colors, badges) stays in the page; this is the data shape + the arithmetic.
 */

export const SERIES = "physical-ai";

/** Editorial article titles (1-based), matching the six-part series. */
export const ARTICLE_TITLES: Record<number, string> = {
  1: "日本・上場企業（決算型 catalyst）",
  2: "日本・未上場スタートアップ（イベント型）",
  3: "米国・上場 ロボティクス",
  4: "米国・上場 半導体・センサ",
  5: "米国・未上場 ロボット本体",
  6: "米国・未上場 AI モデル・基盤",
};

export const JUDGED: EvaluationStatus[] = ["hit", "partial", "miss", "na"];

export interface HitRate {
  counts: Record<"hit" | "partial" | "miss" | "na" | "pending", number>;
  /** hit + partial + miss + na */
  judged: number;
  /** total number of conditions in the group */
  total: number;
  /** (hit + partial×0.5) / (hit + partial + miss); null when nothing scored. */
  rate: number | null;
}

/** Track record for a list of catalysts. Partial = half hit; na is excluded. */
export function hitRate(list: ExternalCatalyst[]): HitRate {
  const counts = { hit: 0, partial: 0, miss: 0, na: 0, pending: 0 };
  for (const c of list) counts[c.status] += 1;
  const judged = counts.hit + counts.partial + counts.miss + counts.na;
  const scored = counts.hit + counts.partial + counts.miss;
  const rate = scored > 0 ? (counts.hit + counts.partial * 0.5) / scored : null;
  return { counts, judged, total: list.length, rate };
}

/** Split the folded "condition【外れ方向】fail" description into its two halves. */
export function splitDescription(desc: string): {
  condition: string;
  fail_direction: string | null;
} {
  const marker = "【外れ方向】";
  const idx = desc.indexOf(marker);
  if (idx === -1) return { condition: desc, fail_direction: null };
  return {
    condition: desc.slice(0, idx),
    fail_direction: desc.slice(idx + marker.length),
  };
}

/** Filter a raw catalyst list to the physical-ai series, sorted by target_date. */
export function selectSeries(all: ExternalCatalyst[]): ExternalCatalyst[] {
  return all
    .filter((c) => c.series === SERIES)
    .sort((a, b) => a.target_date.localeCompare(b.target_date));
}

export interface ScoreboardCatalyst {
  catalyst_id: string;
  ticker: string;
  company_name: string | null;
  market: "US" | "JP";
  country: string | null;
  catalyst_type: ExternalCatalyst["catalyst_type"] | null;
  date_confidence: ExternalCatalyst["date_confidence"] | null;
  catalyst_role: ExternalCatalyst["catalyst_role"] | null;
  parent_catalyst_id: string | null;
  series_article: number | null;
  condition: string;
  fail_direction: string | null;
  target_date: string;
  status: EvaluationStatus;
  judgement_date: string | null;
  evidence_urls: string[];
  reasoning: string | null;
}

export interface ScoreboardArticle {
  article: number;
  title: string;
  hit_rate: number | null;
  judged: number;
  total: number;
}

export interface Scoreboard {
  series: string;
  as_of: string;
  overall: {
    hit_rate: number | null;
    counts: HitRate["counts"];
    judged: number;
    total: number;
  };
  articles: ScoreboardArticle[];
  catalysts: ScoreboardCatalyst[];
}

/** Flatten a catalyst into the machine-readable scoreboard shape. */
export function toScoreboardCatalyst(c: ExternalCatalyst): ScoreboardCatalyst {
  const { condition, fail_direction } = splitDescription(c.catalyst_description);
  return {
    catalyst_id: c.catalyst_id,
    ticker: c.ticker,
    company_name: c.company_name ?? null,
    market: c.market ?? "US",
    country: c.country ?? null,
    catalyst_type: c.catalyst_type ?? null,
    date_confidence: c.date_confidence ?? null,
    catalyst_role: c.catalyst_role ?? null,
    parent_catalyst_id: c.parent_catalyst_id ?? null,
    series_article: c.series_article ?? null,
    condition,
    fail_direction,
    target_date: c.target_date,
    status: c.status,
    judgement_date: c.judgement_date,
    evidence_urls: c.evidence_urls ?? [],
    reasoning: c.reasoning,
  };
}

/**
 * Build the full scoreboard payload from the raw external-catalyst list.
 * `asOf` is passed in (routes/pages own the clock) so this stays pure.
 */
export function buildScoreboard(
  all: ExternalCatalyst[],
  asOf: string,
): Scoreboard {
  const series = selectSeries(all);
  const overall = hitRate(series);

  const byArticle = new Map<number, ExternalCatalyst[]>();
  for (const c of series) {
    const key = c.series_article ?? 0;
    if (!byArticle.has(key)) byArticle.set(key, []);
    byArticle.get(key)!.push(c);
  }
  const articles: ScoreboardArticle[] = [...byArticle.keys()]
    .sort((a, b) => a - b)
    .map((article) => {
      const stat = hitRate(byArticle.get(article)!);
      return {
        article,
        title: ARTICLE_TITLES[article] ?? "その他",
        hit_rate: stat.rate,
        judged: stat.judged,
        total: stat.total,
      };
    });

  return {
    series: SERIES,
    as_of: asOf,
    overall: {
      hit_rate: overall.rate,
      counts: overall.counts,
      judged: overall.judged,
      total: overall.total,
    },
    articles,
    catalysts: series.map(toScoreboardCatalyst),
  };
}
