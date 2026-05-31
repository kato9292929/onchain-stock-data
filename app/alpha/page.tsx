import Script from "next/script";
import Link from "next/link";
import { getAlphaPosts } from "@/lib/data";

export default async function AlphaPage() {
  const posts = await getAlphaPosts();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Alpha Signals</h1>
        <p className="text-sm text-zinc-400">
          注目している X (Twitter) 投稿。post の選定はオーナーの手動キュレーション
          (Claude Code は自動収集しません)。
        </p>
        <p className="text-xs text-zinc-500">
          edit list:{" "}
          <code className="text-zinc-300">data/alpha-posts.json</code>
        </p>
      </header>

      <Link
        href="/alpha/portfolio"
        className="block terminal-card p-4 hover:border-cyan-500/50 hover:no-underline"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-cyan-300 font-bold">Claude Portfolio →</span>
          <span className="text-xs text-zinc-500">無料公開 · 週次更新</span>
        </div>
        <p className="text-sm text-zinc-400 mt-1">
          毎週月曜朝 6 時 (JST) に Claude が選ぶ米株 10 銘柄。SPY / QQQ 比較と履歴付き。
          JSON: <code className="text-zinc-300">/api/alpha/portfolio/current</code>
        </p>
      </Link>

      <section
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        aria-label="alpha posts"
      >
        {posts.map((post) => (
          <blockquote
            key={post.url}
            className="twitter-tweet"
            data-theme="dark"
          >
            <a href={post.url}>{post.url}</a>
          </blockquote>
        ))}
      </section>

      <Script
        src="https://platform.twitter.com/widgets.js"
        strategy="lazyOnload"
      />
    </div>
  );
}
