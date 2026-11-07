import Link from "next/link";
import { notFound } from "next/navigation";
import { freeBody, freeConditions } from "@/lib/solana-stocks";
import { issuerShort, loadSolanaStocks } from "@/lib/solana-stocks-load";
import { PER_CALL_PRICE, PUBLIC_BASE_URL } from "@/lib/x402";
import { CopyMint } from "../../components/copy-mint";
import { SolanaMark } from "../../components/solana-mark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One tokenized stock. Free here: the tokens and mints, the next earnings date
 * where a primary source states it, the wording of every condition set on the
 * company, and how many have been judged. Per call (x402): each condition's
 * verdict, the evidence URL and reasoning behind it, its correction history,
 * and the latest disclosed financials — the record this page explains how to
 * buy.
 */

const EARNINGS_LABEL: Record<string, string> = {
  not_announced: "Not announced by the company yet",
  unverified: "No primary source checked",
};

const JUDGED = new Set(["hit", "partial", "miss", "na"]);

function Code({ children }: { children: string }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
      <code>{children}</code>
    </pre>
  );
}

export default async function SolanaStockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();
  const { file, rec, today } = await loadSolanaStocks();
  const free = freeBody(ticker, file, rec, today, PUBLIC_BASE_URL);
  if (!free) notFound();

  const conditions = freeConditions(ticker, rec);
  const judgedN = conditions.filter((c) => JUDGED.has(c.result)).length;
  const counts = ["hit", "partial", "miss", "na"]
    .map((s) => [s, conditions.filter((c) => c.result === s).length] as const)
    .filter(([, n]) => n > 0);
  const ne = free.next_earnings;
  const fullUrl = `${PUBLIC_BASE_URL}/api/solana-stocks/${encodeURIComponent(ticker)}?view=full`;
  const paid = conditions.length > 0;

  return (
    <div className="font-inter space-y-8">
      <Link href="/solana-stocks" className="text-xs text-slate-400 hover:text-slate-600">
        ← All tokenized stocks
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <SolanaMark className="h-3 w-auto" title={null} />
          Tokenized stock on Solana
        </div>
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">
          {free.ticker}{" "}<span className="text-slate-400">· {free.name}</span>
        </h1>
      </header>

      {/* Tokens */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tokens</h2>
        <div className="mt-3 divide-y divide-slate-100">
          {free.tokens.map((t) => (
            <div key={t.solana_mint} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <span className="w-20 font-semibold text-[#0a1b33]">{issuerShort(t.issuer)}</span>
              <span className="text-[13px] text-slate-500">{t.symbol}</span>
              <CopyMint mint={t.solana_mint} full />
              <a
                href={`https://solscan.io/token/${t.solana_mint}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-sky-700 hover:underline"
              >
                Solscan ↗
              </a>
              <a href={t.source_url} target="_blank" rel="noreferrer" className="text-[11px] text-slate-400 hover:underline">
                listed by the issuer ↗
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Next earnings + conditions (free) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next earnings</h2>
          {ne.status === "confirmed" && ne.date ? (
            <>
              <div className="mt-2 font-outfit text-2xl font-semibold tabular-nums text-[#0a1b33]">{ne.date}</div>
              <p className="mt-1 text-[12px] text-emerald-700">Confirmed by the company</p>
              {ne.source_url && (
                <a href={ne.source_url} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] text-sky-700 hover:underline">
                  Source ↗
                </a>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-400">{EARNINGS_LABEL[ne.status] ?? "—"}</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Conditions</h2>
            <span className="text-[12px] tabular-nums text-slate-400">
              {conditions.length} set · {judgedN} judged
              {counts.length > 0 && <> ({counts.map(([s, n]) => `${s} ${n}`).join(" · ")})</>}
            </span>
          </div>
          {conditions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              This site has not set a condition on {free.ticker} yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {conditions.map((c) => (
                <li key={c.id} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span>{c.population}</span>
                    {c.week_of && <span>· week of {c.week_of}</span>}
                    <span className="tabular-nums">· target {c.target_date}</span>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-semibold ${
                        JUDGED.has(c.result) ? "border-slate-300 text-slate-600" : "border-slate-200 text-slate-400"
                      }`}
                    >
                      {JUDGED.has(c.result) ? "judged" : c.result === "excluded" ? "excluded" : "pending"}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{c.question}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Per call */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-[#0a152d] text-white shadow-sm">
        <div className="h-1 w-full bg-gradient-to-r from-[#00FFA3] to-[#DC1FFF]" />
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-outfit text-xl font-semibold">Full record, per call</h2>
            <span className="font-outfit text-xl font-semibold tabular-nums">{PER_CALL_PRICE.usdc} USDC</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <SolanaMark className="h-3 w-auto" title={null} /> USDC on Solana · x402 exact · no account, no API key
            </span>
          </div>
          {paid ? (
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-300">
              <li>Every condition with its verdict (hit / partial / miss / na) and the reasoning</li>
              <li>The evidence URL each verdict was judged against — the company&apos;s filing or release</li>
              <li>verdict_history: earlier verdicts and why they were corrected (never overwritten)</li>
              <li>Latest disclosed financials (SEC EDGAR / TDnet XBRL), each value with its filing URL and YoY</li>
            </ul>
          ) : (
            <p className="text-[13px] text-slate-300">
              No condition is set on {free.ticker} yet, so there is nothing to sell: the full view answers free
              (200) with the same fields as above.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Terminal · see the 402</h3>
          <Code>{`curl -i "${fullUrl}"`}</Code>
          <p className="text-[12px] text-slate-500">
            {paid ? (
              <>
                Answers <span className="font-semibold">HTTP 402</span> with a <code>PAYMENT-REQUIRED</code> header
                (base64 JSON: network <code>solana:5eykt4…</code>, asset USDC, amount{" "}
                <code>{PER_CALL_PRICE.base_units}</code>). The free view is the same URL without{" "}
                <code>?view=full</code>.
              </>
            ) : (
              <>Answers 200 free for this ticker.</>
            )}
          </p>
          <h3 className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">x402 client · pay and read</h3>
          <Code>{`import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const signer = await createKeyPairSignerFromBytes(secretKey); // a wallet holding USDC
const client = new x402Client();
registerExactSvmScheme(client, { signer });
const http = new x402HTTPClient(client);

const url = "${fullUrl}";
const challenge = await fetch(url);                       // 402
const required = http.getPaymentRequiredResponse(
  (h) => challenge.headers.get(h),
);
const payment = await http.createPaymentPayload(required); // signs a USDC transfer
const res = await fetch(url, { headers: http.encodePaymentSignatureHeader(payment) });
console.log(await res.json());                            // 200 + full record`}</Code>
          <p className="text-[12px] text-slate-500">
            Gas is sponsored by the facilitator — the wallet needs USDC, not SOL. Discovery:{" "}
            <Link href="/.well-known/x402.json" className="text-sky-700 hover:underline">
              /.well-known/x402.json
            </Link>
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">MCP · free view</h3>
          <Code>{`claude mcp add --transport http onchain-stock-data ${PUBLIC_BASE_URL}/api/mcp`}</Code>
          <p className="text-[12px] text-slate-500">Then call the read-only tool:</p>
          <Code>{`solana_stock_get({ "ticker": "${free.ticker}" })`}</Code>
          <p className="text-[12px] text-slate-500">
            Returns the free view — tokens and mints, next earnings (primary source only), condition counts, latest
            verdict, and the per-call URL above. MCP reads are free; the full record is the HTTP endpoint. Fields:{" "}
            <Link href="/docs" className="text-sky-700 hover:underline">
              /docs
            </Link>
          </p>
          <h3 className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Free JSON</h3>
          <Code>{`curl "${PUBLIC_BASE_URL}/api/solana-stocks/${encodeURIComponent(free.ticker)}"`}</Code>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Informational only — not investment advice. No market prices are shown or used; conditions are judged on
        the company&apos;s disclosures.
      </p>
    </div>
  );
}
