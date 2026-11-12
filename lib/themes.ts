import {
  conditionsFor,
  freeRow,
  latestVerdict,
  nextEarningsOf,
  type ConditionRowFull,
  type Records,
  type RowStatus,
} from "@/lib/company-record";
import { membersOf, type ThemeDef, type ThemesFile } from "@/lib/theme-members";
import type { SolanaStocksFile } from "@/lib/solana-stocks";
import { isNeocloudTheme, memberPower, metricSeries, neocloudCompanies, powerTotals } from "@/lib/neocloud";

export { getThemes, membersOf, themesFor, type ThemeDef, type ThemesFile } from "@/lib/theme-members";

/**
 * Theme responses. A theme is a sector × market (or an article series cut the
 * same way); its member list follows the latest article edition, older
 * editions' conditions stay on record with a status, and Weekly picks show up
 * in the sector they belong to. Membership itself is lib/theme-members.ts.
 */

const membershipOf = (rec: Records) => ({
  usHistory: rec.usHistory,
  jpHistory: rec.jpHistory ?? null,
  externals: rec.externals,
  jpListed: rec.jpListed ?? null,
});

export const members = (theme: ThemeDef, rec: Records) => membersOf(theme, membershipOf(rec));

/** The nearest active catalyst. */
function currentCatalyst(rows: readonly ConditionRowFull[]): ConditionRowFull | null {
  return [...rows].filter((r) => r.status === "active").sort((a, b) => (a.target_date < b.target_date ? -1 : 1))[0] ?? null;
}

function solanaMints(ticker: string, solana: SolanaStocksFile | null | undefined) {
  return (solana?.tokens ?? [])
    .filter((t) => t.ticker === ticker)
    .map((t) => ({ issuer: t.issuer, symbol: t.symbol, solana_mint: t.solana_mint }));
}

const within = (date: string | null | undefined, today: string, days: number) => {
  if (!date || date < today) return false;
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5 <= days;
};

/** The date that matters next: a confirmed earnings date, else the current catalyst's. */
function nextEventDate(ticker: string, rows: readonly ConditionRowFull[], rec: Records, today: string) {
  const ne = nextEarningsOf(ticker, rec, today);
  const cur = currentCatalyst(rows);
  const dates = [ne.status === "confirmed" ? ne.date : null, cur?.target_date ?? null]
    .filter((d): d is string => Boolean(d) && (d as string) >= today)
    .sort();
  return dates[0] ?? null;
}

const STATUSES: RowStatus[] = ["active", "judged", "superseded", "expired"];

export function statusCounts(rows: readonly ConditionRowFull[]): Record<RowStatus, number> {
  const out = { active: 0, judged: 0, superseded: 0, expired: 0 } as Record<RowStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** Every member's rows, once per theme call. */
function memberRows(theme: ThemeDef, rec: Records, today: string) {
  return members(theme, rec).map((m) => ({ m, rows: conditionsFor(m.ticker, rec, today) }));
}

const latestArticle = (t: ThemeDef) => t.lineage.find((a) => a.role === "latest") ?? t.lineage.at(-1) ?? null;

function lineageOut(t: ThemeDef) {
  const latest = latestArticle(t);
  return t.lineage.map((a) => ({ url: a.url, title: a.title, published_at: a.published_at, latest: a === latest }));
}

/** GET /api/themes — themes (active first, then rank) and, apart, the weekly selections. */
export function themesIndexBody(themes: ThemesFile, rec: Records, today: string) {
  const card = (t: ThemeDef) => {
    const mr = memberRows(t, rec, today);
    const rows = mr.flatMap((x) => x.rows);
    return {
      id: t.id,
      kind: t.kind,
      title_ja: t.title_ja,
      title_en: t.title_en,
      market: t.market,
      member_count: mr.length,
      active_catalysts: rows.filter((r) => r.status === "active").length,
      events_next_14_days: mr.filter(({ m, rows: r }) => within(nextEventDate(m.ticker, r, rec, today), today, 14)).length,
      latest_article: latestArticle(t)?.url ?? null,
    };
  };
  const byRank = [...themes.themes].sort((a, b) => a.rank - b.rank);
  const cards = byRank.filter((t) => t.kind !== "weekly").map(card);
  return {
    updated_at: themes.updated_at,
    // Themes with something to judge come first; rank (readership) within each half.
    themes: [...cards.filter((c) => c.active_catalysts > 0), ...cards.filter((c) => c.active_catalysts === 0)],
    selections: byRank.filter((t) => t.kind === "weekly").map(card),
  };
}

export function findTheme(themes: ThemesFile | null | undefined, id: string): ThemeDef | null {
  return themes?.themes.find((t) => t.id === id.toLowerCase()) ?? null;
}

/** GET /api/themes/{theme} — free: the member list with dates. */
export function themeFreeBody(
  theme: ThemeDef,
  rec: Records,
  solana: SolanaStocksFile | null | undefined,
  today: string,
  baseUrl: string,
) {
  const mr = memberRows(theme, rec, today);
  const list = mr.map(({ m, rows }) => ({
    ticker: m.ticker,
    company: m.company,
    listed: m.listed,
    group: m.group ?? null,
    source_article: m.source_article ?? null,
    next_earnings: nextEarningsOf(m.ticker, rec, today),
    next_event_date: nextEventDate(m.ticker, rows, rec, today),
    active_catalysts: rows.filter((r) => r.status === "active").length,
    solana_token: solanaMints(m.ticker, solana).length > 0,
    ...(isNeocloudTheme(theme) ? { power: memberPower(rec.neocloud, m.ticker) } : {}),
  }));
  return {
    id: theme.id,
    kind: theme.kind,
    title_ja: theme.title_ja,
    title_en: theme.title_en,
    market: theme.market,
    lineage: lineageOut(theme),
    member_count: list.length,
    active_catalysts: list.reduce((n, x) => n + x.active_catalysts, 0),
    ...(isNeocloudTheme(theme) ? { power_totals: neocloudPowerTotals(theme, rec) } : {}),
    members: list,
    full: {
      url: `${baseUrl}/api/themes/${encodeURIComponent(theme.id)}?view=full`,
      price_usdc: "0.01",
      network: "solana",
      scheme: "exact",
    },
  };
}

/** GET /api/themes/{theme}?view=full — paid: every member's catalysts by status, latest verdict, mints. */
export function themeFullBody(
  theme: ThemeDef,
  rec: Records,
  solana: SolanaStocksFile | null | undefined,
  today: string,
) {
  const mr = memberRows(theme, rec, today);
  const list = mr.map(({ m, rows }) => {
    const cur = currentCatalyst(rows);
    return {
      ticker: m.ticker,
      company: m.company,
      listed: m.listed,
      group: m.group ?? null,
      source_article: m.source_article ?? null,
      next_earnings: nextEarningsOf(m.ticker, rec, today),
      current_catalyst: cur ? freeRow(cur) : null,
      latest_verdict: latestVerdict(rows),
      status_counts: statusCounts(rows),
      conditions: rows,
      solana_tokens: solanaMints(m.ticker, solana),
      ...(isNeocloudTheme(theme) ? { metrics: metricSeries(rec.neocloud, m.ticker) } : {}),
    };
  });
  return {
    id: theme.id,
    kind: theme.kind,
    title_ja: theme.title_ja,
    title_en: theme.title_en,
    market: theme.market,
    lineage: lineageOut(theme),
    member_count: list.length,
    status_counts: statusCounts(mr.flatMap((x) => x.rows)),
    ...(isNeocloudTheme(theme) ? { power_totals: neocloudPowerTotals(theme, rec) } : {}),
    members: list,
  };
}

/** Contracted and energized MW summed over the theme's article members that disclosed them. */
function neocloudPowerTotals(theme: ThemeDef, rec: Records) {
  const companies = neocloudCompanies(rec.themes).filter((c) => c.theme === theme.id);
  const t = powerTotals(companies, rec.neocloud);
  return theme.market === "JP" ? t.JP : t.US;
}

/**
 * For the weekly chat export: per theme, members with a confirmed earnings
 * date or an active catalyst in the next `days` days.
 */
export function upcomingByTheme(themes: ThemesFile, rec: Records, today: string, days = 14) {
  return [...themes.themes]
    .sort((a, b) => a.rank - b.rank)
    .map((t) => ({
      theme: t,
      members: memberRows(t, rec, today)
        .map(({ m, rows }) => {
          const cur = currentCatalyst(rows);
          return { ...m, date: nextEventDate(m.ticker, rows, rec, today), current: cur ? freeRow(cur) : null };
        })
        .filter((m) => within(m.date, today, days))
        .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? -1 : 1)),
    }))
    .filter((x) => x.members.length > 0);
}

/**
 * Listed members whose conditions have all run out (judged, expired or
 * superseded, none active): their theme needs the next quarter's condition.
 * Members that never had a condition are new coverage, not renewal, and are
 * left out.
 */
export function needsRenewal(themes: ThemesFile, rec: Records, today: string) {
  return [...themes.themes]
    .filter((t) => t.kind !== "weekly")
    .sort((a, b) => a.rank - b.rank)
    .map((t) => ({
      theme: t,
      members: memberRows(t, rec, today)
        .filter(({ m, rows }) => m.listed && rows.length > 0 && !rows.some((r) => r.status === "active"))
        .map(({ m, rows }) => {
          const byDate = [...rows].sort((a, b) => (a.target_date < b.target_date ? 1 : -1));
          const last = byDate.find((r) => r.status !== "superseded") ?? byDate[0];
          return { ...m, counts: statusCounts(rows), last: freeRow(last) };
        }),
    }))
    .filter((x) => x.members.length > 0);
}

export { STATUSES };
