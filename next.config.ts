import type { NextConfig } from "next";

/**
 * Paid API paths are never kept by Vercel's (or any) CDN. The responses also
 * carry Cache-Control: no-store, private on a paid 2xx (lib/x402-route.ts);
 * these CDN-only headers make the edge side explicit without touching what a
 * browser may do with the free responses on the same paths.
 */
const PAID_API_PATHS = [
  "/api/neocloud/:path*",
  "/api/themes/:path*",
  "/api/catalyst/:path*",
  "/api/edinet/:path*",
  "/api/solana-stocks/:path*",
  "/api/alpha/:path*",
  "/api/testnet/:path*",
];

const nextConfig: NextConfig = {
  async headers() {
    return PAID_API_PATHS.map((source) => ({
      source,
      headers: [
        { key: "CDN-Cache-Control", value: "no-store" },
        { key: "Vercel-CDN-Cache-Control", value: "no-store" },
      ],
    }));
  },
  async redirects() {
    // Page routes only — the old /alpha* pages now live at /portfolio.
    // NOTE: API routes (/api/alpha/*) are intentionally NOT redirected; they
    // must keep returning 200 for articles / external agents. These sources are
    // exact paths, so /alpha/portfolio/[ticker] and /alpha/portfolio/history
    // are unaffected and continue to render.
    return [
      { source: "/alpha", destination: "/selection", permanent: false },
      { source: "/alpha/portfolio", destination: "/selection", permanent: false },
      { source: "/alpha/jp", destination: "/selection", permanent: false },
      // Selection, Catalysts and Themes are one list now (/selection).
      { source: "/portfolio", destination: "/selection", permanent: false },
      { source: "/portfolio/jp", destination: "/selection", permanent: false },
      { source: "/catalysts", destination: "/selection", permanent: false },
      { source: "/themes", destination: "/selection", permanent: false },
    ];
  },
};

export default nextConfig;
