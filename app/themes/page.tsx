import { loadRecords } from "@/lib/solana-stocks-load";
import { getThemes, themesIndexBody } from "@/lib/themes";
import { THEME_CALL_PRICE } from "@/lib/x402";
import { ThemeCards } from "../components/theme-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every theme, most-read first. Each leads to its member list and the per-call theme record. */
export default async function ThemesPage() {
  const [themes, rec] = await Promise.all([getThemes(), loadRecords()]);
  if (!themes) return <p className="p-8 text-sm text-slate-400">Couldn&apos;t load the themes.</p>;
  const index = themesIndexBody(themes, rec, new Date().toISOString().slice(0, 10));
  return (
    <div className="font-inter space-y-6">
      <header className="space-y-2">
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">Themes</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          The stock lists the articles were written around, kept current every week: each company&apos;s dated
          catalyst, its next earnings date and whether it trades as a token on Solana. A whole theme is{" "}
          <span className="font-semibold text-slate-700">{THEME_CALL_PRICE.usdc} USDC per call</span> over x402.
        </p>
      </header>
      <ThemeCards themes={index.themes} />
      <section className="space-y-3">
        <h2 className="font-outfit text-xl font-semibold text-[#0a1b33]">This week&apos;s selection</h2>
        <p className="max-w-2xl text-sm text-slate-500">
          Not a sector: the picks of the week. Each pick also appears in the sector theme it belongs to.
        </p>
        <ThemeCards themes={index.selections} />
      </section>
    </div>
  );
}
