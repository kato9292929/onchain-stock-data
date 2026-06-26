import Link from "next/link";
import { readExternalCatalysts } from "@/lib/external-catalysts";
import type { EvaluationStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Japan-equity (AI data-center chain) coverage page. Reads the curated JP
 * catalysts from the shared external-catalysts store and shows each company's
 * role in the chain, its dated catalyst and the current verdict. The verdicts
 * are filled by the same daily judge as the US external submissions.
 */

/** Static role/name map for the covered tickers (display only). */
const PROFILE: Record<string, { name: string; role: string }> = {
  "4062": {
    name: "イビデン",
    role: "FC-BGA（ICパッケージ基板）— AIアクセラレータ向け高多層パッケージ基板の主力",
  },
  "2802": {
    name: "味の素",
    role: "ABF（味の素ビルドアップフィルム）— 半導体パッケージの層間絶縁材で事実上の標準",
  },
  "3110": {
    name: "日東紡",
    role: "ガラスクロス（Tガラス）— 高速・低誘電プリント基板の補強材",
  },
  "6920": {
    name: "レーザーテック",
    role: "EUVマスク欠陥検査装置 — 先端ロジック/メモリの量産に必須",
  },
  "6146": {
    name: "ディスコ",
    role: "ダイシング/グラインダ（精密加工装置）— HBM・先端パッケージの後工程",
  },
};

const STATUS_STYLE: Record<EvaluationStatus, string> = {
  pending: "bg-gold/10 text-gold-bright border-gold/30",
  hit: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  partial: "bg-gold/10 text-gold-bright border-gold/30",
  miss: "bg-red-500/10 text-red-300 border-red-500/30",
  na: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

export default async function JpCatalystsPage() {
  const list = await readExternalCatalysts();
  const jp = list
    .filter((c) => c.market === "JP")
    .sort((a, b) => a.target_date.localeCompare(b.target_date));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">日本株 AI データセンタ・チェーン</h1>
        <p className="text-sm text-zinc-400">
          AI データセンタの製造サプライチェーンに位置する日本株 5
          銘柄の、検証可能な dated catalyst。期日（target_date + 7日）経過後に
          決算短信・適時開示（TDnet）・EDINET などの一次情報で自動採点します。
          JSON は{" "}
          <code className="text-zinc-300">/api/alpha/jp/catalysts</code>{" "}
          で無料公開。米国版は{" "}
          <Link href="/alpha/portfolio" className="text-gold">
            Portfolio
          </Link>{" "}
          を参照。
        </p>
      </header>

      {jp.length === 0 ? (
        <p className="text-sm text-zinc-500">
          まだ catalyst がありません。署名つきエージェント (AA) の submit
          が入り次第ここに表示されます。
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-left border-b border-zinc-800">
            <tr>
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">企業 / 役割</th>
              <th className="py-2 pr-4">Catalyst</th>
              <th className="py-2 pr-4 whitespace-nowrap">目安日</th>
              <th className="py-2">判定</th>
            </tr>
          </thead>
          <tbody>
            {jp.map((c) => {
              const p = PROFILE[c.ticker];
              const status = (c.status ?? "pending") as EvaluationStatus;
              return (
                <tr
                  key={c.catalyst_id}
                  className="border-b border-zinc-900 align-top"
                >
                  <td className="py-3 pr-4 text-gold-bright font-bold">
                    {c.ticker}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-zinc-200 font-bold">
                      {p?.name ?? c.ticker}
                    </div>
                    {p && (
                      <div className="text-xs text-zinc-500 mt-1 max-w-xs">
                        {p.role}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-zinc-400 max-w-md">
                    {c.catalyst_description}
                  </td>
                  <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                    {c.target_date}
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${STATUS_STYLE[status]}`}
                    >
                      {status}
                    </span>
                    {c.evidence_urls?.[0] && (
                      <div className="mt-1">
                        <a
                          href={c.evidence_urls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-gold"
                        >
                          evidence →
                        </a>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <p className="text-xs text-zinc-600">
        目安日は過去の発表時期からの予想であり、各社の正式な決算発表日ではありません。正式日程の公表後に差し替えます。本ページは
        Claude による情報提供であり投資助言ではありません。
      </p>
    </div>
  );
}
