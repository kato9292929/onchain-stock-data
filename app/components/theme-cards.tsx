import Link from "next/link";

export interface ThemeCard {
  id: string;
  title_ja: string;
  title_en: string;
  member_count: number;
  events_next_14_days: number;
}

/** Theme index cards, rank order (most-read articles first). */
export function ThemeCards({ themes }: { themes: ThemeCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {themes.map((t) => (
        <Link
          key={t.id}
          href={`/themes/${t.id}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.title_en}</div>
          <div className="font-outfit text-lg font-semibold text-[#0a1b33]">{t.title_ja}</div>
          <div className="mt-3 flex items-center justify-between text-[12px] tabular-nums text-slate-600">
            <span>{t.member_count} companies</span>
            <span className={t.events_next_14_days > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}>
              {t.events_next_14_days} with an event in 14 days
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
