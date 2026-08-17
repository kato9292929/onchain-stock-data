"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Replica of the landing top header, so detail pages share the exact same
 *  chrome: white logo disc + white pill nav (Home / Portfolio / Catalysts) with
 *  the three-dot active indicator + dark "API" pill. No gold, no dark bar. */
const NAV = [
  { href: "/", label: "Home" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/catalysts", label: "Catalysts" },
];

const SHADOW = "0 4px 14px rgba(0,0,0,0.16)";

export function SiteNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-20 px-4 py-4">
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-4 sm:gap-6">
        {/* Logo disc */}
        <Link
          href="/"
          aria-label="Home"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white transition-transform hover:scale-105 hover:no-underline"
          style={{ boxShadow: SHADOW }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#111"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 3v18h18" />
            <path d="m19 9-5 5-4-4-3 3" />
          </svg>
        </Link>

        {/* White pill nav */}
        <nav
          className="flex h-12 min-w-0 max-w-[430px] flex-1 items-center justify-between gap-1 rounded-full bg-white px-2"
          style={{ boxShadow: SHADOW }}
          aria-label="Primary"
        >
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`font-display relative flex-1 whitespace-nowrap px-1.5 py-2 text-center text-sm tracking-[-0.02em] text-[#2e2e2e]! transition-opacity hover:no-underline ${
                  active ? "opacity-100" : "opacity-50 hover:opacity-75"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute bottom-[5px] left-1/2 flex -translate-x-1/2 gap-[2px]">
                    <span className="h-[3px] w-[3px] rounded-full bg-black" />
                    <span className="h-[3px] w-[3px] rounded-full bg-black" />
                    <span className="h-[3px] w-[3px] rounded-full bg-black" />
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* API pill */}
        <Link
          href="/api/alpha/catalysts/physical-ai"
          className="font-display inline-flex h-12 shrink-0 items-center whitespace-nowrap rounded-full bg-[#28282a] px-5 text-sm text-[#c8c8c8]! transition-all hover:-translate-y-px hover:bg-[#323234] hover:text-white! hover:no-underline"
          style={{ boxShadow: SHADOW }}
        >
          API
        </Link>
      </div>
    </header>
  );
}
