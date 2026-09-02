"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";

/**
 * Light, readable landing hero: rounded white card with a muted background
 * video, animated headline (osd positioning), and a floating bottom navbar.
 * Content adapted to osd — no generic web3 template copy.
 */

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260505_101331_74f9b798-3f00-4e86-8a01-377aa16ffeaa.mp4";

export function LandingHero() {
  return (
    <div className="relative mx-auto flex h-[600px] w-full max-w-[1400px] flex-col overflow-hidden rounded-[48px] border border-slate-200/50 bg-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.03)]">
      {/* background video */}
      <div className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden">
        <video
          className="h-full w-full scale-105 object-cover transition-transform duration-1000"
          autoPlay
          loop
          muted
          playsInline
        >
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>
      </div>

      {/* text content */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative z-20 flex flex-1 flex-col items-start px-8 pt-12 md:px-16 md:pt-16"
      >
        <h1 className="font-outfit text-[42px] font-medium leading-[1.05] tracking-tight text-[#0a1b33] md:text-[56px]">
          Claude-run
          <br />
          equity research
        </h1>
        <p className="font-inter mt-5 max-w-md text-[14px] leading-relaxed text-[#64748b] md:text-[15px]">
          Weekly US &amp; Japan stock picks with dated, numeric catalysts — each
          scored HIT / PARTIAL / MISS once its deadline passes. A public,
          verifiable track record, delivered over REST and x402.
        </p>
        <Link href="/catalysts">
          <motion.span
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="font-inter mt-7 inline-flex items-center gap-1 rounded-full bg-[#0a152d] px-6 py-3 text-[13px] font-semibold text-white shadow-sm"
          >
            View catalysts <ChevronRight className="h-4 w-4" />
          </motion.span>
        </Link>
      </motion.div>

      {/* floating bottom navbar */}
      <div className="absolute bottom-10 left-1/2 z-30 -translate-x-1/2">
        <motion.nav
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.35 }}
          className="flex items-center rounded-full border border-slate-200/40 bg-white/90 px-1.5 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-100 bg-white text-[#0a1b33] shadow-sm">
            ✦
          </div>
          <Link
            href="/catalysts"
            className="px-4 text-[12px] font-semibold text-slate-500 transition-colors hover:text-[#0a1b33]"
          >
            Catalysts
          </Link>
          <Link
            href="/portfolio"
            className="px-4 text-[12px] font-semibold text-slate-500 transition-colors hover:text-[#0a1b33]"
          >
            Selection
          </Link>
          <Link
            href="/.well-known/x402.json"
            className="flex items-center gap-1 rounded-full border border-slate-200/60 bg-white px-5 py-2 text-[12px] font-semibold text-[#0a1b33] shadow-sm transition-all hover:border-slate-300"
          >
            API <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </motion.nav>
      </div>
    </div>
  );
}
