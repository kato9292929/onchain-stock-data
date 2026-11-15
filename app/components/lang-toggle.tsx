"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** JP | EN switch. Sets the osd_lang cookie (a year) and re-renders the page on the server. */
export function LangToggle({ lang, className = "" }: { lang: "en" | "ja"; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: "en" | "ja") => {
    if (l === lang) return;
    document.cookie = `osd_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  const btn = (l: "en" | "ja", label: string) => (
    <button
      type="button"
      onClick={() => set(l)}
      aria-pressed={lang === l}
      className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
        lang === l ? "bg-[#0a1b33] text-white" : "text-slate-500 hover:text-[#0a1b33]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm ${pending ? "opacity-60" : ""} ${className}`}
    >
      {btn("ja", "JP")}
      {btn("en", "EN")}
    </div>
  );
}
