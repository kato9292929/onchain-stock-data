import Link from "next/link";
import { SECTORS } from "@/lib/catalyst-sectors";

/**
 * Seamless CSS marquee of the equity SECTORS the board covers (not a tech-stack
 * "powered by" strip). Each item is an Article-card–sized box (same rounded
 * card, kicker + title notation as the Physical-AI article cards), links to its
 * sector page, pauses on hover, edge-masked. Track rendered twice for a
 * seamless -50% loop.
 */

function SectorCard({
  slug,
  kicker,
  title,
  sub,
}: {
  slug: string;
  kicker: string;
  title: string;
  sub: string;
}) {
  return (
    <Link
      href={`/catalysts/${slug}`}
      className="mx-2 flex h-24 w-72 shrink-0 flex-col justify-center rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition-all hover:border-slate-300 hover:no-underline!"
    >
      <div className="text-[11px] text-slate-400">{kicker}</div>
      <div className="font-outfit text-sm font-semibold leading-snug text-[#0a1b33]">
        {title}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </Link>
  );
}

export function RailMarquee() {
  const items = [...SECTORS, ...SECTORS];
  return (
    <div className="osd-marquee osd-marquee-mask mx-auto w-full max-w-[1400px] overflow-hidden py-2">
      <div className="osd-marquee-track">
        {items.map((s, i) => (
          <SectorCard
            key={`${s.slug}-${i}`}
            slug={s.slug}
            kicker={s.decision_type}
            title={s.title_en}
            sub={s.title_ja}
          />
        ))}
      </div>
    </div>
  );
}
