export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-800 bg-black mt-12">
      <div className="max-w-6xl mx-auto px-6 py-8 text-xs text-zinc-500 space-y-3">
        <p className="text-zinc-300 font-bold">免責事項 / Disclaimer</p>
        <p>
          本サイトの情報は投資助言ではありません。表示価格・流動性・保有者情報は
          参考値であり、実際の取引執行前に各取引所・チェーン上で最新値を確認してください。
        </p>
        <p>
          xStocks は Backed Finance が発行する tokenized stocks であり、
          米国・英国・カナダ・オーストラリア・EU 等の居住者は購入できない場合があります。
          ご自身の居住地域の規制をご確認ください。 / xStocks may be unavailable to
          residents of the US, UK, Canada, Australia, and EU jurisdictions —
          verify local eligibility before transacting.
        </p>
        <p className="pt-2 text-zinc-400">
          Data sources: xStocks (Backed Finance) · Backpack IPOs Onchain
          (Superstate × Solana) · Jupiter · Helius · yfinance · alpha posts
          manually curated by the owner.
        </p>
        <p>
          <a
            href="https://github.com/kato9292929/onchain-stock-data"
            className="text-cyan-400"
          >
            github.com/kato9292929/onchain-stock-data
          </a>
        </p>
      </div>
    </footer>
  );
}
