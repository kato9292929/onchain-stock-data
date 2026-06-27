"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/stocks", label: "Stocks" },
  { href: "/ipo", label: "IPO" },
  { href: "/liquidity", label: "Liquidity" },
  { href: "/holders", label: "Holders" },
  { href: "/analyst", label: "Analyst" },
];

export function SiteNav() {
  const pathname = usePathname();
  // The active item is the single longest href that prefixes the current path,
  // so /alpha/portfolio highlights "Portfolio" without also lighting up "Alpha".
  const activeHref = NAV.map((n) => n.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <header className="border-b border-zinc-800 bg-black/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Link
          href="/"
          className="text-zinc-100 hover:no-underline flex items-center gap-2 text-lg font-bold tracking-tight"
        >
          Onchain Stock Data
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {NAV.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded ${
                  active
                    ? "bg-gold/10 text-gold-bright hover:no-underline"
                    : "text-zinc-400 hover:text-zinc-100 hover:no-underline"
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
