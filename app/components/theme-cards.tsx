import Link from "next/link";
import { pick, type Lang } from "@/lib/i18n";

export interface ThemeCard {
  id: string;
  kind?: string;
  title_ja: string;
  title_en: string;
  member_count: number;
  active_catalysts: number;
  events_next_14_days: number;
}

const KIND: Record<string, [string, string]> = {
  article: ["Article theme", "記事テーマ"],
  sector: ["Sector", "セクター"],
  weekly: ["Weekly selection", "今週の選定"],
};

/**
 * Theme index cards, rank order. Same shape as the Catalysts article cards on
 * the front page: a small label, a small bold title, one line of numbers.
 * One language at a time (lib/i18n).
 */
export function ThemeCards({ themes, lang = "en" }: { themes: ThemeCard[]; lang?: Lang }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {themes.map((t) => {
        const kind = t.kind ? KIND[t.kind] : undefined;
        return (
          <Link
            key={t.id}
            href={`/themes/${t.id}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
          >
            <div className="text-[11px] text-slate-400">{kind ? pick(lang, kind[0], kind[1]) : " "}</div>
            <div className="font-outfit text-sm font-semibold text-[#0a1b33]">{pick(lang, t.title_en, t.title_ja)}</div>
            <div className="mt-2 text-[11px] tabular-nums text-slate-500">
              {pick(lang, "Active", "有効な条件")}{" "}
              <span className={t.active_catalysts > 0 ? "font-semibold text-[#0a1b33]" : ""}>{t.active_catalysts}</span>
              {" · "}
              {pick(lang, "In 14 days", "14日以内")}{" "}
              <span className={t.events_next_14_days > 0 ? "font-semibold text-[#0a1b33]" : ""}>{t.events_next_14_days}</span>
              {" · "}
              {pick(lang, `${t.member_count} companies`, `${t.member_count}社`)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
