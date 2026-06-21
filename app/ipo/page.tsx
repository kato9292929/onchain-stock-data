import { getIpos } from "@/lib/data";
import { DataBanner } from "../components/data-banner";

export default async function IpoPage() {
  const data = await getIpos();
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Onchain IPO Calendar</h1>
        <p className="text-sm text-zinc-400">
          Backpack IPOs Onchain (Superstate × Solana) — primary issuance
          waitlist 状況。
        </p>
      </header>

      <DataBanner
        source={data.source}
        note={data.note}
        updatedAt={data.updated_at}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {data.ipos.map((i) => (
          <div key={i.ticker} className="terminal-card p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-gold-bright font-bold text-lg">
                  {i.ticker}
                </div>
                <div className="text-zinc-100">{i.company_name}</div>
                <div className="text-xs text-zinc-500">{i.sector}</div>
              </div>
              <div className="text-right text-xs">
                <div className="text-zinc-500">planned</div>
                <div className="text-zinc-100">{i.planned_listing_date}</div>
                <div className="text-zinc-500 mt-1">{i.target_listing_market}</div>
              </div>
            </div>
            <div className="space-y-1 pt-2 border-t border-zinc-800">
              {i.primary_issuance_platforms.map((p) => (
                <a
                  key={p.platform}
                  href={p.url}
                  className="block text-sm hover:no-underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="text-gold">{p.platform}</span>
                  <span className="text-zinc-500"> · {p.partner}</span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gold/10 text-gold-bright">
                    {p.status}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
