"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/catalysts", label: "Catalysts" },
];

export function SiteNav() {
  const pathname = usePathname();
  // The active item is the single longest href that prefixes the current path,
  // so /alpha/portfolio highlights "Portfolio" without also lighting up "Alpha".
  const activeHref = NAV.map((n) => n.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Link
          href="/"
          className="font-display text-white hover:no-underline flex items-center gap-2 text-xl"
        >
          Onchain Stock Data
        </Link>
        <nav className="flex flex-wrap gap-1.5 text-sm">
          {NAV.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-1.5 rounded-full transition-colors hover:no-underline ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
