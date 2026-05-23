import Script from "next/script";
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
