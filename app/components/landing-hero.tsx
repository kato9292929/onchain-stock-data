"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { SolanaMark } from "./solana-mark";

/**
 * Light, readable landing hero: rounded white card with a muted background
 * video, animated headline (osd positioning), and a floating bottom navbar.
 * Content adapted to osd — no generic web3 template copy.
 */

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260505_101331_74f9b798-3f00-4e86-8a01-377aa16ffeaa.mp4";

/**
 * `themeCount` comes from data/themes.json and `solanaCount` from
 * data/solana-stocks.json, so both follow the weekly refresh.
 */
export function LandingHero({
  solanaCount,
  themeCount,
  pricePerCall,
  intro = true,
}: {
  solanaCount: number;
  themeCount: number;
  /** USDC per call, passed in by the server page (lib/x402 stays out of the client bundle). */
  pricePerCall: number;
  /** false: the headline and description are already at the top of the page (SiteIntro). */
  intro?: boolean;
}) {
  return (
    <div className="relative mx-auto flex min-h-[600px] w-full max-w-[1400px] flex-col overflow-hidden rounded-[48px] border border-slate-200/50 bg-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.03)]">
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
        className="relative z-20 flex flex-1 flex-col items-start px-8 pb-28 pt-12 md:px-16 md:pt-16"
      >
        {intro && (
          <>
            <h1 className="font-outfit text-[42px] font-medium leading-[1.05] tracking-tight text-[#0a1b33] md:text-[56px]">
              Stock data,
              <br />
              per call
            </h1>
            <p className="font-inter mt-5 max-w-md text-[14px] leading-relaxed text-[#64748b] md:text-[15px]">
              Company filings and financials for {solanaCount.toLocaleString()} tokenized stocks on
              Solana — SEC filings and XBRL financials for US companies, large-holding
              reports for Japan, every value with its source document. No account, no
              API key: agents pay {pricePerCall} USDC per call with x402.
            </p>
          </>
        )}

        {/* First view: the stocks are the front door. */}
        <Link
          href="/solana-stocks"
          className="font-inter mt-6 inline-flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-3 shadow-sm backdrop-blur-sm transition-all hover:border-slate-300 hover:no-underline!"
        >
          <span className="flex flex-col">
            <span className="font-outfit text-[26px] font-semibold leading-none tabular-nums text-[#0a1b33]">
              {solanaCount.toLocaleString()} stocks
            </span>
            <span className="mt-1 text-[12px] font-semibold text-slate-500">
              conditions · verdicts · filings — per call
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
              <SolanaMark className="h-2.5 w-auto" title={null} /> tokenized on Solana
            </span>
          </span>
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#0a152d] px-4 py-2 text-[12px] font-semibold text-white">
            Browse <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Link>

        <Link
          href="#x402"
          className="font-inter mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/90 px-4 py-2 text-[12px] font-semibold text-[#0a1b33]! shadow-sm backdrop-blur-sm transition-all hover:border-slate-300 hover:no-underline!"
        >
          <SolanaMark className="h-3 w-auto" title={null} />
          Paid in USDC on Solana
          <span className="text-slate-400">· no SOL needed</span>
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
            href="/solana-stocks"
            className="px-2.5 text-[12px] font-semibold text-slate-500 transition-colors hover:text-[#0a1b33] sm:px-4"
          >
            Stocks
          </Link>
          <Link
            href="/selection"
            className="px-2.5 text-[12px] font-semibold text-slate-500 transition-colors hover:text-[#0a1b33] sm:px-4"
          >
            Selection
          </Link>
          <Link
            href="/.well-known/x402.json"
            className="flex items-center gap-1 rounded-full border border-slate-200/60 bg-white px-3 py-2 text-[12px] sm:px-5 font-semibold text-[#0a1b33] shadow-sm transition-all hover:border-slate-300"
          >
            API <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </motion.nav>
      </div>
    </div>
  );
}
