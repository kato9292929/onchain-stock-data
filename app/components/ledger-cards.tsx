import type { LedgerItem } from "@/lib/front-ledger";
import { pick, type Lang } from "@/lib/i18n";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "document";
  }
};

function Verdict({ it, lang }: { it: LedgerItem; lang: Lang }) {
  if (it.status === "active") return <span className="text-slate-500">{pick(lang, "Pending", "判定待ち")}</span>;
  if (it.status === "expired") return <span className="text-slate-500">{pick(lang, "Awaiting verdict", "判定中")}</span>;
  const cls =
    it.result === "hit" ? "bg-emerald-50 text-emerald-700" : it.result === "miss" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
  return <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${cls}`}>{it.result}</span>;
}

/**
 * One condition per card, the same four things for every company:
 * who, what has to be disclosed, by when, and the verdict with its document.
 */
export function LedgerCards({ items, lang }: { items: LedgerItem[]; lang: Lang }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <div key={it.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] text-slate-400">{it.ticker}</div>
          <div className="truncate font-outfit text-sm font-semibold text-[#0a1b33]">{it.company}</div>
          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-slate-700" title={it.condition}>
            {it.condition}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[11px] tabular-nums">
            <span className="text-slate-400">
              {pick(lang, "Due", "期日")} <span className="text-slate-600">{it.target_date}</span>
            </span>
            <Verdict it={it} lang={lang} />
            {it.evidence_url && it.status === "judged" && (
              <a href={it.evidence_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
                {host(it.evidence_url)} →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
