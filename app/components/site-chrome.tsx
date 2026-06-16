"use client";

import { usePathname } from "next/navigation";
import { SiteNav } from "./site-nav";
import { SiteFooter } from "./site-footer";

/**
 * Renders the shared nav + padded main + footer for every route EXCEPT the
 * home page ("/"), which ships its own full-bleed chrome (gold nav/footer per
 * the redesign). Detail pages are unchanged.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteNav />
      <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
