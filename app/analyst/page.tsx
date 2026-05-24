import { promises as fs } from "node:fs";
import path from "node:path";
import { PRICING_USD, TIME_ESTIMATE } from "@/lib/analyst/templates";

interface SampleOutput {
  _meta?: { source: string; note: string };
  ticker: string;
  company_name: string;
  depth: string;
  verdict: string;
  target_price_usd: number;
  position_size_pct: number;
  decision_card: {
    summary: string;
    key_metrics: Record<string, string | number>;
  };
  bull_case: string;
  bear_case: string;
  investment_thesis: Array<{ point: string; supporting_data: string }>;
  anti_thesis: Array<{ point: string; supporting_data: string }>;
  valuation: Record<
    string,
    { name: string; value_usd: number; assumptions: string }
  >;
  top_risks: Array<{
    severity: number;
    likelihood: number;
    description: string;
  }>;
  decision_triggers: { upgrade_if: string[]; downgrade_if: string[] };
  sources_called: Array<{
    endpoint: string;
    cost_usd: number;
    data_summary: string;
  }>;
  total_cost_usd: number;
  disclaimer: string;
}

async function loadSample(): Promise<SampleOutput> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "sample-analyst-output.json"),
    "utf8",
  );
  return JSON.parse(raw) as SampleOutput;
}

const fmtUsd = (n: number) =>
  n >= 1e9
    ? "$" + (n / 1e9).toFixed(0) + "B"
    : n >= 1e6
      ? "$" + (n / 1e6).toFixed(1) + "M"
      : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const VERDICT_COLOR: Record<string, string> = {
  BUY: "text-emerald-300 bg-emerald-400/10",
  HOLD: "text-zinc-200 bg-zinc-700/30",
  SELL: "text-rose-300 bg-rose-400/10",
  WATCH: "text-amber-300 bg-amber-400/10",
};

export default async function AnalystPage() {
  const sample = await loadSample();
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div className="text-xs text-cyan-400">/analyst</div>
        <h1 className="text-2xl font-bold">Analyst</h1>
        <p className="text-sm text-zinc-400 max-w-2xl">
          AI エージェントが既存 5 API (stocks / ipo / liquidity / holders /
          alpha-posts) を並列で叩いて、Claude で構造化 IC memo を生成する
          有料エンドポイントです。
          <span className="text-amber-300">
            {" "}
            これはエージェント向け API です
          </span>{" "}
          (ブラウザでは無料で本ページとサンプルを閲覧可)。
        </p>
      </header>

      <section className="terminal-card p-4 space-y-3">
        <h2 className="text-lg font-bold text-zinc-100">Depth × Pricing</h2>
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500">
            <tr className="text-left border-b border-zinc-800">
              <th className="py-2 font-normal">depth</th>
              <th className="py-2 font-normal">data sources</th>
              <th className="py-2 font-normal">time</th>
              <th className="py-2 font-normal text-right">price (USDC)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-800/60">
              <td className="py-2 text-cyan-300 font-bold">quick</td>
              <td className="py-2 text-zinc-400">5 internal endpoints only</td>
              <td className="py-2 text-zinc-400">{TIME_ESTIMATE.quick}</td>
              <td className="py-2 text-right text-zinc-100">
                ${PRICING_USD.quick.toFixed(2)}
              </td>
            </tr>
            <tr className="border-b border-zinc-800/60">
              <td className="py-2 text-cyan-300 font-bold">standard</td>
              <td className="py-2 text-zinc-400">
                + SEC EDGAR filings (recent)
              </td>
              <td className="py-2 text-zinc-400">{TIME_ESTIMATE.standard}</td>
              <td className="py-2 text-right text-zinc-100">
                ${PRICING_USD.standard.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td className="py-2 text-cyan-300 font-bold">deep</td>
              <td className="py-2 text-zinc-400">
                + earnings call transcript + comparable financials
              </td>
              <td className="py-2 text-zinc-400">{TIME_ESTIMATE.deep}</td>
              <td className="py-2 text-right text-zinc-100">
                ${PRICING_USD.deep.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">
          Settlement: Base USDC or Solana USDC via{" "}
          <a href="https://x402.org" className="text-cyan-400">
            x402
          </a>
          . AA (Anthropic Agent) や 自社 backend には `X-Internal-Key` で課金スキップ。
        </p>
      </section>

      <section className="terminal-card p-4 space-y-3">
        <h2 className="text-lg font-bold text-zinc-100">Request / Response</h2>
        <pre className="text-xs text-zinc-300 bg-black/60 border border-zinc-800 rounded p-3 overflow-x-auto">
{`# Agent (x402-charged)
curl -X POST https://onchain-stock-data.vercel.app/api/analyst \\
  -H "Content-Type: application/json" \\
  -d '{"ticker": "SPCX", "depth": "standard"}'
# → HTTP 402 with x402 challenge ($1.50 USDC)

# Internal (zero-cost, AA / self-hosted backends)
curl -X POST https://onchain-stock-data.vercel.app/api/analyst \\
  -H "Content-Type: application/json" \\
  -H "X-Internal-Key: $INTERNAL_API_KEY" \\
  -d '{"ticker": "SPCX", "depth": "standard"}'
# → HTTP 200 with structured JSON report

# Browser (free HTML, this page)
open https://onchain-stock-data.vercel.app/analyst`}
        </pre>
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">
            Python SDK example
          </summary>
          <pre className="bg-black/60 border border-zinc-800 rounded p-3 mt-2 overflow-x-auto">
{`import requests, os
res = requests.post(
    "https://onchain-stock-data.vercel.app/api/analyst",
    headers={
        "Content-Type": "application/json",
        "X-Internal-Key": os.environ["INTERNAL_API_KEY"],
    },
    json={"ticker": "SPCX", "depth": "standard"},
    timeout=300,
)
res.raise_for_status()
report = res.json()
print(report["verdict"], report["target_price_usd"])`}
          </pre>
        </details>
        <details className="text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">
            JavaScript / x402-fetch example
          </summary>
          <pre className="bg-black/60 border border-zinc-800 rounded p-3 mt-2 overflow-x-auto">
{`import { wrapFetchWithPayment } from "x402-fetch";
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);
const res = await fetchWithPay(
  "https://onchain-stock-data.vercel.app/api/analyst",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "SPCX", depth: "standard" }),
  },
);
const report = await res.json();
console.log(report.verdict, report.target_price_usd);`}
          </pre>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-zinc-100">
          Sample output — {sample.ticker} ({sample.depth}, $
          {sample.total_cost_usd.toFixed(2)})
        </h2>
        {sample._meta && (
          <div className="text-xs px-3 py-2 rounded border border-amber-500/40 bg-amber-500/5 text-amber-200">
            <span className="font-bold">{sample._meta.source}:</span>{" "}
            {sample._meta.note}
          </div>
        )}

        <div className="terminal-card p-4 space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <span className="text-cyan-300 font-bold text-xl">
                {sample.ticker}
              </span>
              <span className="text-zinc-100 ml-2">{sample.company_name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded font-bold text-xs ${
                  VERDICT_COLOR[sample.verdict] ?? "text-zinc-200"
                }`}
              >
                {sample.verdict}
              </span>
              <span className="text-sm text-zinc-300">
                target {fmtUsd(sample.target_price_usd)} · size{" "}
                {sample.position_size_pct.toFixed(1)}%
              </span>
            </div>
          </div>
          <p className="text-sm text-zinc-300">{sample.decision_card.summary}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(sample.decision_card.key_metrics).map(([k, v]) => (
              <div key={k} className="border border-zinc-800 rounded p-2">
                <div className="text-zinc-500">{k}</div>
                <div className="text-zinc-200">{String(v)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="terminal-card p-4 space-y-2">
            <div className="text-emerald-300 font-bold text-sm">Bull case</div>
            <p className="text-sm text-zinc-300">{sample.bull_case}</p>
          </div>
          <div className="terminal-card p-4 space-y-2">
            <div className="text-rose-300 font-bold text-sm">Bear case</div>
            <p className="text-sm text-zinc-300">{sample.bear_case}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="terminal-card p-4 space-y-2">
            <div className="text-zinc-100 font-bold text-sm">
              Investment thesis
            </div>
            <ul className="text-xs text-zinc-400 space-y-2">
              {sample.investment_thesis.map((t, idx) => (
                <li key={idx}>
                  <div className="text-zinc-200">▸ {t.point}</div>
                  <div className="text-zinc-500 pl-3">{t.supporting_data}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="terminal-card p-4 space-y-2">
            <div className="text-zinc-100 font-bold text-sm">Anti-thesis</div>
            <ul className="text-xs text-zinc-400 space-y-2">
              {sample.anti_thesis.map((t, idx) => (
                <li key={idx}>
                  <div className="text-zinc-200">▸ {t.point}</div>
                  <div className="text-zinc-500 pl-3">{t.supporting_data}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="terminal-card p-4 space-y-3">
          <div className="text-zinc-100 font-bold text-sm">Valuation</div>
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            {Object.values(sample.valuation).map((m, idx) => (
              <div key={idx} className="border border-zinc-800 rounded p-3">
                <div className="text-cyan-300 font-bold">{m.name}</div>
                <div className="text-zinc-100 mt-1">{fmtUsd(m.value_usd)}</div>
                <div className="text-zinc-400 mt-1">{m.assumptions}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="terminal-card p-4 space-y-2">
          <div className="text-zinc-100 font-bold text-sm">Top risks</div>
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr className="text-left">
                <th className="font-normal py-1">sev</th>
                <th className="font-normal py-1">likelihood</th>
                <th className="font-normal py-1">risk</th>
              </tr>
            </thead>
            <tbody>
              {sample.top_risks.map((r, idx) => (
                <tr key={idx} className="border-t border-zinc-800/60">
                  <td className="py-1 text-rose-300">{r.severity}</td>
                  <td className="py-1 text-amber-300">{r.likelihood}</td>
                  <td className="py-1 text-zinc-300">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="terminal-card p-4">
            <div className="text-emerald-300 font-bold text-sm">
              Upgrade if…
            </div>
            <ul className="text-xs text-zinc-300 mt-2 space-y-1 list-disc pl-5">
              {sample.decision_triggers.upgrade_if.map((t, idx) => (
                <li key={idx}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="terminal-card p-4">
            <div className="text-rose-300 font-bold text-sm">
              Downgrade if…
            </div>
            <ul className="text-xs text-zinc-300 mt-2 space-y-1 list-disc pl-5">
              {sample.decision_triggers.downgrade_if.map((t, idx) => (
                <li key={idx}>{t}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="terminal-card p-4 space-y-2">
          <div className="text-zinc-100 font-bold text-sm">Sources called</div>
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr className="text-left">
                <th className="font-normal py-1">endpoint</th>
                <th className="font-normal py-1">summary</th>
                <th className="font-normal py-1 text-right">cost</th>
              </tr>
            </thead>
            <tbody>
              {sample.sources_called.map((s, idx) => (
                <tr key={idx} className="border-t border-zinc-800/60">
                  <td className="py-1 font-mono text-cyan-300">{s.endpoint}</td>
                  <td className="py-1 text-zinc-400">{s.data_summary}</td>
                  <td className="py-1 text-right text-zinc-500">
                    ${s.cost_usd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-zinc-500 italic">
          {sample.disclaimer}
        </p>
      </section>
    </div>
  );
}
