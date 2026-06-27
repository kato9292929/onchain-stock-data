import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Page routes only — the old /alpha* pages now live at /portfolio.
    // NOTE: API routes (/api/alpha/*) are intentionally NOT redirected; they
    // must keep returning 200 for articles / external agents. These sources are
    // exact paths, so /alpha/portfolio/[ticker] and /alpha/portfolio/history
    // are unaffected and continue to render.
    return [
      { source: "/alpha", destination: "/portfolio", permanent: false },
      { source: "/alpha/portfolio", destination: "/portfolio", permanent: false },
      { source: "/alpha/jp", destination: "/portfolio", permanent: false },
    ];
  },
};

export default nextConfig;
