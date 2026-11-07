import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExternalCatalyst, JpPortfolioHistoryFile, PortfolioHistoryFile } from "@/lib/data";
import { sectorSlugFor } from "@/lib/catalyst-sectors";

/**
 * Who belongs to which theme. Kept apart from lib/themes.ts (which builds the
 * responses) so lib/company-record.ts can tag rows with their themes without an
 * import cycle.
 *
 * A theme's members are the latest article edition's list (data/themes.json),
 * plus any company a catalyst was later added to under the theme
 * (theme_catalysts), plus Weekly picks tagged with it — and for a sector theme
 * with `weekly_sector`, every JP Weekly pick whose TSE sector maps there.
 * Weekly themes are the current week's picks.
 */

export interface ThemeArticle {
  url: string;
  title: string;
  published_at: string;
  pageviews: number | null;
  /** "latest" on the edition the member list follows. */
  role?: "latest";
}

export interface ThemeMemberDef {
  ticker: string;
  company: string | null;
  listed: boolean;
  /** The article's own sub-grouping, e.g. "GPUクラウド直販". */
  group?: string;
  /** Where the company was picked from, when that is not the theme's own article. */
  source_article?: string;
}

export interface ThemeDef {
  id: string;
  rank: number;
  title_ja: string;
  title_en: string;
  market: "US" | "JP";
  /** article: an article series · sector: a sector of the Japanese market · weekly: the week's selection. */
  kind: "article" | "sector" | "weekly";
  /** Editions, oldest first. */
  lineage: ThemeArticle[];
  members?: ThemeMemberDef[];
  /** Sector slug (lib/catalyst-sectors.ts) whose JP Weekly picks join this theme. */
  weekly_sector?: string;
}

export interface ThemesFile {
  updated_at: string;
  themes: ThemeDef[];
}

export interface JpListedFile {
  listed: Record<string, { name: string; segment?: string; sector33?: string }>;
}

/** The records membership is decided from. Any may be missing. */
export interface MembershipRecords {
  usHistory: PortfolioHistoryFile | null;
  jpHistory?: JpPortfolioHistoryFile | null;
  externals: ExternalCatalyst[];
  jpListed?: JpListedFile | null;
}

export interface ThemeMember extends ThemeMemberDef {
  /** How the company came to be in the theme. */
  via: "article" | "added" | "weekly";
}

export async function getThemes(): Promise<ThemesFile | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "themes.json"), "utf8")) as ThemesFile;
  } catch {
    return null;
  }
}

export async function getJpListed(): Promise<JpListedFile | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "jp-listed.json"), "utf8")) as JpListedFile;
  } catch {
    return null;
  }
}

const JP_CODE = /^\d{3}[0-9A-Z]$/;
const upper = (t: unknown) => String(t ?? "").trim().toUpperCase();

type Holding = Record<string, unknown>;
function weeksOf(h: { current: unknown; history: unknown[] } | null | undefined): Array<{ holdings: Holding[] }> {
  return [...(h?.current ? [h.current] : []), ...(h?.history ?? [])] as Array<{ holdings: Holding[] }>;
}

const memo = new WeakMap<object, Map<string, ThemeMember[]>>();

/** Who is in a theme, deduplicated, article order first. */
export function membersOf(theme: ThemeDef, rec: MembershipRecords): ThemeMember[] {
  let byTheme = memo.get(rec);
  if (!byTheme) memo.set(rec, (byTheme = new Map()));
  const hit = byTheme.get(theme.id);
  if (hit) return hit;

  const list: ThemeMember[] = [];
  if (theme.kind === "weekly") {
    const h = theme.market === "US" ? rec.usHistory : rec.jpHistory;
    for (const x of (h?.current?.holdings ?? []) as unknown as Holding[]) {
      list.push({ ticker: upper(x.ticker), company: (x.company_name as string) ?? null, listed: true, via: "weekly" });
    }
  } else {
    for (const x of theme.members ?? []) list.push({ ...x, ticker: upper(x.ticker), via: "article" });
    for (const c of rec.externals) {
      if (c.series !== theme.id) continue;
      // A past edition's row, or a company an edition dropped, does not make a member.
      const x = c as { edition?: string; superseded_reason?: string };
      if (x.edition === "history" || x.superseded_reason) continue;
      const market = c.market ?? (JP_CODE.test(upper(c.ticker)) ? "JP" : "US");
      const listed = market === "JP" ? JP_CODE.test(upper(c.ticker)) : !(c as { unlisted?: boolean }).unlisted;
      list.push({ ticker: upper(c.ticker), company: c.company_name ?? null, listed, via: "added" });
    }
    for (const h of [rec.usHistory, rec.jpHistory]) {
      for (const w of weeksOf(h as never)) {
        for (const x of w.holdings ?? []) {
          const t = upper(x.ticker);
          const tagged = Array.isArray(x.themes) && (x.themes as string[]).includes(theme.id);
          const sector33 = rec.jpListed?.listed?.[t]?.sector33;
          const bySector =
            theme.weekly_sector && h === rec.jpHistory && sector33 && sectorSlugFor(sector33, t) === theme.weekly_sector;
          if (tagged || bySector) {
            list.push({ ticker: t, company: (x.company_name as string) ?? null, listed: true, group: "Weekly", via: "weekly" });
          }
        }
      }
    }
  }
  const seen = new Map<string, ThemeMember>();
  for (const x of list) {
    const prev = seen.get(x.ticker);
    if (!prev) seen.set(x.ticker, x);
    else if (!prev.company && x.company) seen.set(x.ticker, { ...prev, company: x.company });
  }
  const out = [...seen.values()];
  byTheme.set(theme.id, out);
  return out;
}

/** Theme ids a ticker belongs to, in rank order. `sectorOnly` leaves out the article and weekly themes. */
export function themesFor(
  ticker: string,
  themes: ThemesFile | null | undefined,
  rec: MembershipRecords,
  { sectorOnly = false }: { sectorOnly?: boolean } = {},
): string[] {
  const want = upper(ticker);
  return [...(themes?.themes ?? [])]
    .filter((t) => t.kind !== "weekly" && (!sectorOnly || t.kind === "sector"))
    .sort((a, b) => a.rank - b.rank)
    .filter((t) => membersOf(t, rec).some((m) => m.ticker === want))
    .map((t) => t.id);
}
