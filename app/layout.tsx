import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "./components/site-chrome";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Inter — the landing page's UI font; shared here so detail pages match the top.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Background video shared with the landing page, so /portfolio, /catalysts, …
// sit on the same backdrop as the top. A dark scrim keeps tables/charts legible.
const BG_VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4";

export const metadata: Metadata = {
  title: "Onchain Stock Data",
  description:
    "Solana 上の株式トークン (xStocks) と Backpack IPOs Onchain の情報を統合した API + Web ページ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased bg-black`}
    >
      <body className="min-h-full flex flex-col text-zinc-100">
        <div className="site-bg" aria-hidden="true">
          <video className="site-bg-video" autoPlay muted loop playsInline>
            <source src={BG_VIDEO_SRC} type="video/mp4" />
          </video>
          <div className="site-bg-scrim"></div>
        </div>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
