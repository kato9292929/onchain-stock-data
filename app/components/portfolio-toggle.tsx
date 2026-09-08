import Link from "next/link";

/** US / JP segmented switch shared by the two portfolio pages. */
export function PortfolioToggle({ active }: { active: "us" | "jp" }) {
  const tabs: { key: "us" | "jp"; href: string; label: string }[] = [
    { key: "us", href: "/portfolio", label: "US" },
    { key: "jp", href: "/portfolio/jp", label: "JP" },
  ];
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-1.5 rounded-full transition-colors hover:no-underline! ${
            active === t.key
              ? "bg-white text-slate-900 font-semibold shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
