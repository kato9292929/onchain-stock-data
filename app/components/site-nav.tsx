"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/stocks", label: "Stocks" },
  { href: "/ipo", label: "IPO" },
  { href: "/liquidity", label: "Liquidity" },
  { href: "/holders", label: "Holders" },
  { href: "/alpha", label: "Alpha" },
  { href: "/alpha/portfolio", label: "Portfolio" },
  { href: "/analyst", label: "Analyst" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-zinc-800 bg-black/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Link
          href="/"
          className="text-zinc-100 hover:no-underline flex items-baseline gap-3"
        >
          <span className="text-lg font-bold tracking-tight">
            <span className="text-cyan-400">$</span> onchain-stock-data
          </span>
          <span className="text-xs text-zinc-500 hidden md:inline">
            Solana × xStocks × Backpack IPOs
          </span>
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded ${
                  active
                    ? "bg-cyan-400/10 text-cyan-300 hover:no-underline"
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
