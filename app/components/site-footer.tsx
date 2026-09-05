export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 mt-12">
      <div className="max-w-6xl mx-auto px-6 py-8 text-xs text-slate-500 space-y-3">
        <p className="text-slate-800 font-bold">Disclaimer</p>
        <p>
          Information on this site is not investment advice. Prices, liquidity and
          holder figures are indicative — verify the latest values on the relevant
          exchange / chain before transacting.
        </p>
        <p>
          xStocks are tokenized stocks issued by Backed Finance and may be
          unavailable to residents of the US, UK, Canada, Australia, and EU
          jurisdictions — verify local eligibility before transacting.
        </p>
        <p className="pt-2 text-slate-500">
          Data sources: xStocks (Backed Finance) · Backpack IPOs Onchain
          (Superstate × Solana) · Jupiter · Helius · yfinance · alpha posts
          manually curated by the owner.
        </p>
        <p>
          <a
            href="https://github.com/kato9292929/onchain-stock-data"
            className="text-slate-600 hover:text-slate-900"
          >
            github.com/kato9292929/onchain-stock-data
          </a>
        </p>
      </div>
    </footer>
  );
}
