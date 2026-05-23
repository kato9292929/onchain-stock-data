import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "./components/site-nav";
import { SiteFooter } from "./components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-zinc-100 font-mono">
        <SiteNav />
        <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
