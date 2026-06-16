"use client";

import { useEffect } from "react";

/**
 * Adds the `in` class to every `.rv` element inside .osd-home as it scrolls
 * into view (fade/slide-up). prefers-reduced-motion is handled in CSS, which
 * neutralises the transition regardless. Idempotent and self-cleaning.
 */
export function Reveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".osd-home .rv"));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  return null;
}
