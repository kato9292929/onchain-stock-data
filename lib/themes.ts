import { promises as fs } from "node:fs";
import path from "node:path";
import {
  conditionsFor,
  freeRow,
  latestVerdict,
  nextEarningsOf,
  type ConditionRowFull,
  type Records,
} from "@/lib/company-record";
import { sectorSlugFor } from "@/lib/catalyst-sectors";
import type { SolanaStocksFile } from "@/lib/solana-stocks";

/**
 * Themes: the stock lists the articles were written around (neocloud, physical
 * AI, the sector themes, the weekly selections), served as data. A theme is a
 * definition in data/themes.json plus a rule for who is in it; the catalysts
 * come from the same records every other endpoint reads, so a catalyst
 * imported today shows up here today.
 */

export type MembersFrom =
  | { kind: "series"; series: string; market?: "US" | "JP" }
  /** Researched Japanese companies whose sector maps to `slug` (lib/catalyst-sectors.ts). */
  | { kind: "sector"; slug: string }
  | { kind: "weekly"; market: "US" | "JP" };

export interface ThemeDef {
  id: string;
  rank: number;
  title_ja: string;
  title_en: string;
  market: "US" | "JP";
  members_from: MembersFrom;
  articles: Array<{ url: string; title: string; published_at: string; pageviews: number | null }>;
}

export interface ThemesFile {
  updated_at: string;
  themes: ThemeDef[];
}

export async function getThemes(): Promise<ThemesFile | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "themes.json"), "utf8")) as ThemesFile;
  } catch {
    return null;
  }
}

export interface ThemeMember {
  ticker: string;
  company: string | null;
  listed: boolean;
}

const JP_CODE = /^\d{3}[0-9A-Z]$/;
const upper = (t: unknown) => String(t ?? "").trim().toUpperCase();

/** A pick tagged with this theme in any Weekly week, beyond the rule's own members. */
function taggedWeeklyMembers(id: string, rec: Records): ThemeMember[] {
  const out: ThemeMember[] = [];
  for (const h of [rec.usHistory, rec.jpHistory]) {
    for (const w of [...(h?.current ? [h.current] : []), ...(h?.history ?? [])]) {
      for (const x of (w as unknown as { holdings: Array<Record<string, unknown>> }).holdings ?? []) {
        if (Array.isArray(x.themes) && (x.themes as string[]).includes(id)) {
          out.push({ ticker: upper(x.ticker), company: (x.company_name as string) ?? null, listed: true });
        }
      }
    }
  }
  return out;
}

/** Who is in a theme, deduplicated, in a stable order. */
export function membersOf(theme: ThemeDef, rec: Records): ThemeMember[] {
  const list: ThemeMember[] = [];
  const m = theme.members_from;
  if (m.kind === "series") {
    for (const c of rec.externals) {
      // The series the articles were written in, plus catalysts added to this theme since.
      if (c.series !== m.series && c.series !== theme.id) continue;
      const market = c.market ?? (JP_CODE.test(upper(c.ticker)) ? "JP" : "US");
      if (m.market && market !== m.market) continue;
      // Unlisted companies carry a slug as their ticker and say so.
      const listed = market === "JP" ? JP_CODE.test(upper(c.ticker)) : !(c as { unlisted?: boolean }).unlisted;
      list.push({ ticker: upper(c.ticker), company: c.company_name ?? null, listed });
    }
  } else if (m.kind === "sector") {
    for (const c of rec.irFair?.catalysts ?? []) {
      if (c.stage === "draft") continue;
      const slug = (c as { sector_slug?: string }).sector_slug ?? sectorSlugFor(c.sector, c.ticker);
      if (slug === m.slug) list.push({ ticker: upper(c.ticker), company: c.company_name, listed: true });
    }
  } else {
    const h = m.market === "US" ? rec.usHistory : rec.jpHistory;
    for (const x of h?.current?.holdings ?? []) {
      list.push({ ticker: upper(x.ticker), company: x.company_name ?? null, listed: true });
    }
  }
  // Any theme grows past its starting list: a company given a catalyst under
  // the theme (theme_catalysts) is a member from then on, in any market.
  if (m.kind !== "series") {
    for (const c of rec.externals) {
      if (c.series !== theme.id) continue;
      const market = c.market ?? (JP_CODE.test(upper(c.ticker)) ? "JP" : "US");
      const listed = market === "JP" ? JP_CODE.test(upper(c.ticker)) : !(c as { unlisted?: boolean }).unlisted;
      list.push({ ticker: upper(c.ticker), company: c.company_name ?? null, listed });
    }
  }
  list.push(...taggedWeeklyMembers(theme.id, rec));
  const seen = new Map<string, ThemeMember>();
  for (const x of list) {
    const prev = seen.get(x.ticker);
    if (!prev) seen.set(x.ticker, x);
    else if (!prev.company && x.company) seen.set(x.ticker, { ...prev, company: x.company });
  }
  return [...seen.values()];
}

/** Theme ids a ticker belongs to, in rank order. */
export function themesFor(ticker: string, themes: ThemesFile | null | undefined, rec: Records): string[] {
  const want = upper(ticker);
  return [...(themes?.themes ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .filter((t) => membersOf(t, rec).some((m) => m.ticker === want))
    .map((t) => t.id);
}

const PENDING = "pending";

/** The nearest pending catalyst on or after today, else the latest one. */
function currentCatalyst(rows: readonly ConditionRowFull[], today: string): ConditionRowFull | null {
  const pending = rows.filter((r) => r.result === PENDING);
  const ahead = pending.filter((r) => r.target_date >= today).sort((a, b) => (a.target_date < b.target_date ? -1 : 1));
  return ahead[0] ?? [...pending].sort((a, b) => (a.target_date < b.target_date ? 1 : -1))[0] ?? null;
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

/** The date that matters next for a member: a confirmed earnings date, else its current catalyst's. */
function nextEventDate(ticker: string, rows: readonly ConditionRowFull[], rec: Records, today: string) {
  const ne = nextEarningsOf(ticker, rec, today);
  const cur = currentCatalyst(rows, today);
  const dates = [ne.status === "confirmed" ? ne.date : null, cur && cur.target_date >= today ? cur.target_date : null]
    .filter((d): d is string => Boolean(d))
    .sort();
  return dates[0] ?? null;
}

/** GET /api/themes — every theme, rank order. */
export function themesIndexBody(themes: ThemesFile, rec: Records, today: string) {
  return {
    updated_at: latestUpdate(themes, rec),
    themes: [...themes.themes]
      .sort((a, b) => a.rank - b.rank)
      .map((t) => {
        const members = membersOf(t, rec);
        const rows = members.map((m) => conditionsFor(m.ticker, rec));
        return {
          id: t.id,
          title_ja: t.title_ja,
          title_en: t.title_en,
          market: t.market,
          member_count: members.length,
          events_next_14_days: members.filter((m, i) => within(nextEventDate(m.ticker, rows[i], rec, today), today, 14))
            .length,
          last_catalyst_added: lastAdded(rows.flat()),
        };
      }),
  };
}

function lastAdded(rows: readonly ConditionRowFull[]): string | null {
  const d = rows.map((r) => r.week_of ?? r.judged_at ?? null).filter((x): x is string => Boolean(x)).sort();
  return d.at(-1) ?? null;
}

function latestUpdate(themes: ThemesFile, rec: Records): string {
  return [themes.updated_at, rec.usEvals?.updated_at, (rec.jpEvals as { updated_at?: string } | null)?.updated_at]
    .filter((x): x is string => Boolean(x))
    .map((x) => x.slice(0, 10))
    .sort()
    .at(-1)!;
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
  const members = membersOf(theme, rec).map((m) => {
    const rows = conditionsFor(m.ticker, rec);
    return {
      ticker: m.ticker,
      company: m.company,
      listed: m.listed,
      next_earnings: nextEarningsOf(m.ticker, rec, today),
      next_event_date: nextEventDate(m.ticker, rows, rec, today),
      condition_count: rows.length,
      solana_token: solanaMints(m.ticker, solana).length > 0,
    };
  });
  return {
    id: theme.id,
    title_ja: theme.title_ja,
    title_en: theme.title_en,
    market: theme.market,
    articles: theme.articles.map(({ url, title, published_at }) => ({ url, title, published_at })),
    member_count: members.length,
    members,
    full: {
      url: `${baseUrl}/api/themes/${encodeURIComponent(theme.id)}?view=full`,
      price_usdc: "0.01",
      network: "solana",
      scheme: "exact",
    },
  };
}

/** GET /api/themes/{theme}?view=full — paid: every member's catalysts, latest verdict, Solana mints. */
export function themeFullBody(
  theme: ThemeDef,
  rec: Records,
  solana: SolanaStocksFile | null | undefined,
  today: string,
) {
  const members = membersOf(theme, rec).map((m) => {
    const rows = conditionsFor(m.ticker, rec);
    const cur = currentCatalyst(rows, today);
    return {
      ticker: m.ticker,
      company: m.company,
      listed: m.listed,
      next_earnings: nextEarningsOf(m.ticker, rec, today),
      current_catalyst: cur ? freeRow(cur) : null,
      latest_verdict: latestVerdict(rows),
      conditions: rows,
      solana_tokens: solanaMints(m.ticker, solana),
    };
  });
  return {
    id: theme.id,
    title_ja: theme.title_ja,
    title_en: theme.title_en,
    market: theme.market,
    articles: theme.articles.map(({ url, title, published_at }) => ({ url, title, published_at })),
    member_count: members.length,
    members,
  };
}

/**
 * For the weekly chat export: per theme, the members with a confirmed earnings
 * date or a pending catalyst date in the next `days` days, with their current
 * catalyst. These are the rows the chat renews with `theme_catalysts`.
 */
export function upcomingByTheme(themes: ThemesFile, rec: Records, today: string, days = 14) {
  return [...themes.themes]
    .sort((a, b) => a.rank - b.rank)
    .map((t) => ({
      theme: t,
      members: membersOf(t, rec)
        .map((m) => {
          const rows = conditionsFor(m.ticker, rec);
          const date = nextEventDate(m.ticker, rows, rec, today);
          const cur = currentCatalyst(rows, today);
          return { ...m, date, current: cur ? freeRow(cur) : null };
        })
        .filter((m) => within(m.date, today, days))
        .sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? -1 : 1)),
    }))
    .filter((x) => x.members.length > 0);
}
