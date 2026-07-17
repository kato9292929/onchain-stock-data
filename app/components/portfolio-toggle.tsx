import Link from "next/link";

/** US / JP segmented switch shared by the two portfolio pages. */
export function PortfolioToggle({ active }: { active: "us" | "jp" }) {
  const tabs: { key: "us" | "jp"; href: string; label: string }[] = [
    { key: "us", href: "/portfolio", label: "米国株 US" },
    { key: "jp", href: "/portfolio/jp", label: "日本株 JP" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-1.5 rounded-md hover:no-underline ${
            active === t.key
              ? "bg-gold/15 text-gold-bright font-bold"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
