import { cookies, headers } from "next/headers";

/**
 * Page language: English or Japanese, one at a time (no side-by-side).
 *
 *   1. the osd_lang cookie, set by the JP | EN switch (app/components/lang-toggle.tsx)
 *   2. else the browser's Accept-Language: Japanese first → ja
 *   3. else en
 *
 * Server components call getLang() and pick their strings with pick().
 */

export type Lang = "en" | "ja";
export const LANG_COOKIE = "osd_lang";

/** From a cookie value and an Accept-Language header. Pure. */
export function langFrom(cookie: string | undefined | null, acceptLanguage: string | null | undefined): Lang {
  if (cookie === "ja" || cookie === "en") return cookie;
  const first = String(acceptLanguage ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return first?.startsWith("ja") ? "ja" : "en";
}

export async function getLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return langFrom(c.get(LANG_COOKIE)?.value, h.get("accept-language"));
}

/** The string for this language. */
export const pick = (lang: Lang, en: string, ja: string) => (lang === "ja" ? ja : en);
