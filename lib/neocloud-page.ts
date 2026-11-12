import {
  conditionsFor,
  freeRow,
  nextEarningsOf,
  type ConditionRow,
  type Records,
} from "@/lib/company-record";
import type { ExternalCatalyst } from "@/lib/data";
import { latestMetrics, neocloudCompanies, type PublicMetric } from "@/lib/neocloud";
import type { ThemeDef } from "@/lib/theme-members";

/**
 * The neocloud theme page, for the readers of the most-read articles (the 7/31
 * editions): per company, what its current condition is and what became of the
 * earlier editions' conditions.
 *
 * An earlier condition is in exactly one of four states:
 *   judged     a verdict was given (hit / partial / miss / na) — with its evidence
 *   before     the deadline is ahead — with the date it is judged on
 *   awaiting   the deadline passed, no verdict yet
 *   replaced   rewritten rather than carried into the next edition (a chat
 *              rewrite, or dropped from the theme) — with what replaced it
 * Carrying into the next article edition is not "replaced": that is the
 * lineage, and the old condition still gets its own verdict.
 */

export type EarlierState = "judged" | "before" | "awaiting" | "replaced";
export const EARLIER_STATES: EarlierState[] = ["judged", "before", "awaiting", "replaced"];

export const STATE_LABELS: Record<EarlierState, { ja: string; en: string }> = {
  judged: { ja: "判定済み", en: "Judged" },
  before: { ja: "期日前", en: "Before deadline" },
  awaiting: { ja: "判定待ち", en: "Awaiting verdict" },
  replaced: { ja: "差し替え済み", en: "Replaced" },
};

export const RESULT_LABELS: Record<string, { ja: string; en: string }> = {
  hit: { ja: "当たり", en: "Hit" },
  partial: { ja: "一部当たり", en: "Partial" },
  miss: { ja: "外れ", en: "Miss" },
  na: { ja: "判定不能", en: "N/A" },
  excluded: { ja: "対象外", en: "Excluded" },
};

type Raw = ExternalCatalyst & {
  source_url?: string;
  edition?: string;
  article_verdict?: string;
  superseded_by?: string;
  superseded_reason?: string;
  author?: string;
  success_conditions?: Array<{ metric: string; operator: string; threshold: { value: number; unit: string } }>;
};

const JUDGED = new Set(["hit", "partial", "miss", "na", "excluded"]);
const question = (c: Raw) => String(c.catalyst_description ?? "").replace(/【外れ方向】[\s\S]*$/, "").trim();

export interface EarlierRow {
  id: string;
  edition: string | null;
  edition_url: string;
  question: string;
  target_date: string;
  state: EarlierState;
  result: string | null;
  evidence_url: string | null;
  reasoning: string | null;
  /** What the next edition (or a rewrite) carried it into. */
  next: { question: string; target_date: string; by: "article" | "rewrite" } | null;
  replaced_reason: string | null;
  /** The next article's own one-word assessment — not a verdict. */
  article_note: { text: string; edition: string | null } | null;
}

/** One earlier condition's state. Pure. */
export function earlierState(c: Raw, successor: Raw | null, today: string): EarlierState {
  if (JUDGED.has(c.status)) return "judged";
  if (c.superseded_reason || (successor && successor.author !== "article")) return "replaced";
  return c.target_date >= today ? "before" : "awaiting";
}

export interface NeocloudCard {
  ticker: string;
  company: string;
  listed: boolean;
  /** false: an earlier edition's company that the latest edition dropped. */
  member: boolean;
  group: string | null;
  next_earnings: { date: string | null; kind: "confirmed" | "estimated" | "not_announced" | "unknown"; source_url: string | null };
  current: ConditionRow[];
  earlier: EarlierRow[];
  power: { contracted_power_mw: PublicMetric | null; energized_mw: PublicMetric | null };
}

/** Everything the page shows, for one neocloud theme. Pure over the records. */
export function neocloudThemeView(theme: ThemeDef, rec: Records, today: string) {
  const editionOf = new Map(theme.lineage.map((a) => [a.url, a.published_at]));
  const raws = (rec.externals ?? []) as Raw[];
  const byId = new Map(raws.map((r) => [r.catalyst_id, r]));
  const members = neocloudCompanies(rec.themes).filter((c) => c.theme === theme.id);
  const memberSet = new Set(members.map((c) => c.ticker));
  // Earlier editions' companies the latest edition no longer lists keep a card,
  // so every earlier condition stays on the page.
  const dropped = [
    ...new Map(
      raws
        .filter((r) => r.series === theme.id && r.edition === "history" && !memberSet.has(r.ticker.toUpperCase()))
        .map((r) => [r.ticker.toUpperCase(), r]),
    ).values(),
  ].map((r) => ({
    ticker: r.ticker.toUpperCase(),
    company: r.company_name ?? r.ticker,
    market: theme.market === "JP" ? ("JP" as const) : ("US" as const),
    listed: false,
    group: null,
    theme: theme.id,
    member: false,
  }));
  const companies = [...members.map((c) => ({ ...c, member: true })), ...dropped];

  const cards: NeocloudCard[] = companies.map((c) => {
    const rows = conditionsFor(c.ticker, rec, today);
    const current = rows
      .filter((r) => r.status === "active")
      .sort((a, b) => (a.target_date < b.target_date ? -1 : 1))
      .map(freeRow);

    const earlier: EarlierRow[] = raws
      .filter((r) => r.series === theme.id && r.edition === "history" && r.ticker.toUpperCase() === c.ticker)
      .sort((a, b) => ((editionOf.get(a.source_url ?? "") ?? "") < (editionOf.get(b.source_url ?? "") ?? "") ? 1 : -1))
      .map((r) => {
        const succ = r.superseded_by ? (byId.get(r.superseded_by) ?? null) : null;
        const state = earlierState(r, succ, today);
        return {
          id: r.catalyst_id,
          edition: editionOf.get(r.source_url ?? "") ?? null,
          edition_url: r.source_url ?? "",
          question: question(r),
          target_date: r.target_date,
          state,
          result: JUDGED.has(r.status) ? r.status : null,
          evidence_url: r.evidence_urls?.[0] ?? null,
          reasoning: r.reasoning ?? null,
          next: succ
            ? { question: question(succ), target_date: succ.target_date, by: succ.author === "article" ? "article" : "rewrite" }
            : null,
          replaced_reason: r.superseded_reason ?? null,
          article_note: r.article_verdict
            ? { text: r.article_verdict, edition: succ && succ.author === "article" ? (editionOf.get(succ.source_url ?? "") ?? null) : null }
            : null,
        };
      });

    // Next earnings: a confirmed date; else the date the current condition is
    // judged on when it was set as an estimate of the next results.
    const ne = c.listed ? nextEarningsOf(c.ticker, rec, today) : null;
    const estimated = raws.find(
      (r) => r.ticker.toUpperCase() === c.ticker && r.status === "pending" && r.edition !== "history" &&
        r.date_confidence === "estimated" && r.target_date >= today && /決算|earnings|results/i.test(r.catalyst_description),
    );
    const next_earnings: NeocloudCard["next_earnings"] =
      ne?.status === "confirmed" && ne.date
        ? { date: ne.date, kind: "confirmed", source_url: ne.source_url }
        : estimated
          ? { date: estimated.target_date, kind: "estimated", source_url: null }
          : ne?.status === "not_announced"
            ? { date: null, kind: "not_announced", source_url: null }
            : { date: null, kind: "unknown", source_url: null };

    const l = latestMetrics(rec.neocloud, c.ticker);
    return {
      ticker: c.ticker,
      company: c.company,
      listed: c.listed,
      member: c.member,
      group: c.group,
      next_earnings,
      current,
      earlier,
      power: { contracted_power_mw: l.contracted_power_mw, energized_mw: l.energized_mw },
    };
  });

  const all = cards.flatMap((x) => x.earlier);
  const count = (rows: EarlierRow[]) =>
    Object.fromEntries(EARLIER_STATES.map((s) => [s, rows.filter((r) => r.state === s).length])) as Record<EarlierState, number>;
  const editions = [...new Set(all.map((r) => r.edition ?? "?"))].sort();
  return {
    cards,
    earlier_total: all.length,
    earlier_counts: count(all),
    by_edition: editions.map((e) => ({ edition: e, total: all.filter((r) => (r.edition ?? "?") === e).length, counts: count(all.filter((r) => (r.edition ?? "?") === e)) })),
  };
}

/** The lineage as a chain of dates, articles of the same date together. Pure. */
export function lineageChain(theme: ThemeDef) {
  const latest = theme.lineage.find((a) => a.role === "latest") ?? theme.lineage.at(-1);
  const byDate = new Map<string, Array<{ url: string; title: string; latest: boolean }>>();
  for (const a of [...theme.lineage].sort((x, y) => (x.published_at < y.published_at ? -1 : 1))) {
    byDate.set(a.published_at, [...(byDate.get(a.published_at) ?? []), { url: a.url, title: a.title, latest: a === latest }]);
  }
  return [...byDate.entries()].map(([date, articles]) => ({ date, articles }));
}
