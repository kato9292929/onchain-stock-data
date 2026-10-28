import { getPortfolioEvaluations, getPortfolioHistory } from "@/lib/data";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import { getSignals } from "@/lib/signals";
import { getSolanaStocks, summarize, type TickerSummary } from "@/lib/solana-stocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tokenized stocks on Solana (xStocks, Ondo Global Markets), one row per
 * underlying ticker, joined to what this site records about the company.
 * Minimal on purpose: a list to look things up in, not a dashboard.
 */

const SOURCE_LABEL: Record<string, string> = {
  verified: "IR 確認済み",
  model: "推定",
  article: "記事の期日",
};

const STATUS_CLS: Record<string, string> = {
  hit: "text-emerald-600",
  partial: "text-amber-600",
  miss: "text-rose-600",
  na: "text-slate-400",
};

function issuerShort(issuer: string): string {
  return issuer.startsWith("xStocks") ? "xStocks" : issuer.startsWith("Ondo") ? "Ondo" : issuer;
}

function Row({ s }: { s: TickerSummary }) {
  const ne = s.next_earnings;
  const v = s.latest_verdict;
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-3 align-top">
        <div className="font-display text-sm tabular-nums text-slate-900">{s.ticker}</div>
        <div className="max-w-[12rem] truncate text-[11px] text-slate-400">{s.name}</div>
      </td>
      <td className="py-1.5 pr-3 align-top text-xs text-slate-600">
        {s.tokens.map((t) => (
          <div key={t.solana_mint} title={t.solana_mint}>
            {issuerShort(t.issuer)}{" "}
            <span className="text-slate-400">{t.symbol}</span>
          </div>
        ))}
      </td>
      <td className="py-1.5 pr-3 align-top text-xs tabular-nums text-slate-600">
        {ne ? (
          <>
            {ne.date}{" "}
            <span
              className={
                ne.target_date_source === "verified" ? "text-emerald-600" : "text-amber-600"
              }
            >
              （{SOURCE_LABEL[ne.target_date_source]}）
            </span>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-1.5 pr-3 align-top text-xs tabular-nums text-slate-600">
        {s.conditions > 0 ? `あり（${s.conditions}）` : <span className="text-slate-300">なし</span>}
      </td>
      <td className="py-1.5 align-top text-xs tabular-nums">
        {v ? (
          <>
            <span className={STATUS_CLS[v.status] ?? "text-slate-500"}>{v.status}</span>{" "}
            <span className="text-slate-400">{v.judged_at ?? ""}</span>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

export default async function SolanaStocksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { q: rawQ, all } = await searchParams;
  const q = (rawQ ?? "").trim().toUpperCase();
  const [file, usHistory, usEvals, externals, signals] = await Promise.all([
    getSolanaStocks().catch(() => null),
    getPortfolioHistory().catch(() => null),
    getPortfolioEvaluations().catch(() => null),
    readExternalCatalysts().catch(() => []),
    getSignals().catch(() => null),
  ]);

  if (!file) {
    return <p className="text-sm text-slate-400">Couldn&apos;t load the token list.</p>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = summarize(file, { usHistory, usEvals, externals, signals }, today).sort((a, b) =>
    // Names we cover first, then alphabetical.
    (b.conditions > 0 ? 1 : 0) - (a.conditions > 0 ? 1 : 0) || (a.ticker < b.ticker ? -1 : 1),
  );
  const covered = rows.filter((r) => r.conditions > 0).length;
  // 1,500+ rows in one page is several MB; show the covered names by default
  // and let a search or "all" reach the rest.
  const shown = q
    ? rows.filter((r) => r.ticker.includes(q) || r.name.toUpperCase().includes(q))
    : all === "1"
      ? rows
      : rows.filter((r) => r.conditions > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-slate-900">Solana stocks</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Solana で発行されている株式トークン（xStocks・Ondo Global Markets）。{rows.length} 銘柄、うち
          このサイトが条件を立てているのは {covered} 銘柄。
        </p>
        <p className="max-w-2xl text-[11px] leading-relaxed text-slate-400">
          次の決算日は、このサイトの条件に付いた期日のうち今日以降で最も早いもの（多くは決算発表日）。
          「IR 確認済み」は会社の IR ページで確認した日付、「推定」は選定モデルが書いた未確認の日付。
          一覧は発行体の公開ページから週1回更新（最終 {file.updated_at.slice(0, 10)}）。mint は発行体名にカーソルを合わせると表示。
          API: <code>/api/solana-stocks/{"{ticker}"}</code>（無料）、条件と判定の全履歴は{" "}
          <code>?view=full</code>（0.001 USDC / call）。
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2 text-xs" action="/solana-stocks">
        <input
          name="q"
          defaultValue={rawQ ?? ""}
          placeholder="ticker / 社名"
          className="w-40 rounded border border-slate-200 px-2 py-1 text-sm"
        />
        <button className="rounded border border-slate-200 px-2 py-1 text-slate-600">検索</button>
        <span className="text-slate-400">
          {q ? `${shown.length} 件` : all === "1" ? `全 ${rows.length} 銘柄` : `条件のある ${covered} 銘柄を表示中`}
          {" · "}
          {all === "1" || q ? (
            <a href="/solana-stocks" className="underline">条件のある銘柄だけ</a>
          ) : (
            <a href="/solana-stocks?all=1" className="underline">全 {rows.length} 銘柄</a>
          )}
        </span>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] text-slate-400">
              <th className="pb-2 pr-3 font-normal">ticker</th>
              <th className="pb-2 pr-3 font-normal">発行体</th>
              <th className="pb-2 pr-3 font-normal">次の決算日</th>
              <th className="pb-2 pr-3 font-normal">条件</th>
              <th className="pb-2 font-normal">直近判定</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <Row key={s.ticker} s={s} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">Informational only — not investment advice.</p>
    </div>
  );
}
