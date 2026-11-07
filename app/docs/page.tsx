import Link from "next/link";
import { PER_CALL_PRICE, PUBLIC_BASE_URL, THEME_CALL_PRICE } from "@/lib/x402";

export const metadata = { title: "API fields — Onchain Stock Data" };

/**
 * Field reference for the API. Responses carry data only; what a field means,
 * where it comes from and how it is computed is written here (and in
 * /.well-known/x402.json), not repeated inside every response.
 */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-outfit text-xl font-semibold text-[#0a1b33]">{title}</h2>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="whitespace-nowrap py-2 pr-4 align-top font-mono text-[12px] text-slate-800">{k}</td>
              <td className="py-2 text-slate-600">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="font-inter space-y-8">
      <header className="space-y-2">
        <h1 className="font-outfit text-3xl font-semibold text-[#0a1b33] sm:text-4xl">API fields</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          What each field in the responses means and where it comes from. Responses carry data only. Paid views are{" "}
          {PER_CALL_PRICE.usdc} USDC per call on Solana (x402 exact); discovery:{" "}
          <Link href="/.well-known/x402.json" className="text-sky-700 hover:underline">
            /.well-known/x402.json
          </Link>
          .
        </p>
      </header>

      <Section id="endpoints" title="Per-company endpoints">
        <Fields
          rows={[
            ["GET /api/solana-stocks/{ticker}", "Free. Tokenized stock on Solana: tokens and mints, next_earnings, condition_count, result_counts, latest_verdict."],
            ["GET /api/solana-stocks/{ticker}?view=full", "Paid when the ticker has a condition. Adds conditions (full rows), financials, signals."],
            ["GET /api/catalyst/{ticker}?view=free", "Free. Any company with a condition (US / JP Weekly, sector themes, neocloud, Physical AI): identity, next_earnings, counts, latest_verdict."],
            ["GET /api/catalyst/{ticker}", "Paid when the company has a condition; a covered company without one gets the free view at no cost. Adds conditions, financials, signals. Both views carry themes (the theme ids the company belongs to)."],
            ["GET /api/themes", "Free. Every theme: id, title, member_count, events_next_14_days, last_catalyst_added."],
            ["GET /api/themes/{theme}", "Free. Members: ticker, company, listed, next_earnings, next_event_date, condition_count, solana_token."],
            [`GET /api/themes/{theme}?view=full`, `Paid, ${THEME_CALL_PRICE.usdc} USDC. Per member: current_catalyst, latest_verdict, conditions (full rows), solana_tokens (issuer, symbol, mint).`],
          ]}
        />
        <p className="text-[12px] text-slate-500">
          Example: <code>{`${PUBLIC_BASE_URL}/api/catalyst/6920?view=free`}</code>. An unknown ticker is 404 before any
          payment is asked for.
        </p>
      </Section>

      <Section id="themes" title="Themes">
        <Fields
          rows={[
            ["id", "neocloud-us, neocloud-jp, physical-ai-us, physical-ai-jp, weekly-us, weekly-jp, and sector themes such as datacenter-power-jp, space-geospatial-jp, infrastructure-jp, semiconductors-fa-jp, healthcare-jp. Ordered by how much the articles behind them were read."],
            ["members", "Neocloud and physical AI: the companies the articles covered (unlisted ones carry a slug ticker and listed: false). Weekly: the current week's picks. Sector themes: researched companies in that sector, plus any company a catalyst was added to under the theme. A company can be in several themes."],
            ["next_event_date", "The nearer of a confirmed earnings date and the current catalyst's target date, on or after today."],
            ["current_catalyst", "The nearest pending catalyst on or after today (else the latest pending one), as a full row."],
            ["success_conditions", "On rows written since 2026-11-05: metric, operator (> >= < <=), threshold {value, unit} and source_doc — the document it is judged against. A disclosure that has to happen is {value: 1, unit: \"event\"}."],
            ["updates", "New catalysts are added weekly through the chat operation (theme_catalysts) and appear the same day; existing ones are never rewritten."],
          ]}
        />
      </Section>

      <Section id="next-earnings" title="next_earnings">
        <p className="text-[13px] text-slate-600">
          The next earnings date, only as a primary source states it. A date estimated by a model is never returned.
          Checked by <code>npm run check:earnings-dates</code> (weekly, no API key) into data/earnings-dates.json.
        </p>
        <Fields
          rows={[
            ["date", "YYYY-MM-DD, or null when status is not confirmed."],
            ["status: confirmed", "A future date read off a primary source; source_url is that source."],
            ["status: not_announced", "JP: the JPX 決算発表予定日 lists were read and carry no future date for the code — the company has not notified one yet."],
            ["status: unverified", "No primary source could be checked (US companies without an announcement on record, or the JPX fetch failed). Counted as 取得失敗."],
            ["source_url", "JP: the JPX schedule workbook (https://www.jpx.co.jp/listing/event-schedules/financial-announcement/). US: the company's IR / press-release page the date was read from."],
            ["checked_at", "When the source was read."],
          ]}
        />
      </Section>

      <Section id="conditions" title="conditions[] and latest_verdict">
        <p className="text-[13px] text-slate-600">
          One row per dated condition this site set on the company. Every row carries the question, the ticker, the
          target date, the result and the evidence URL; rows are never reduced to an id.
        </p>
        <Fields
          rows={[
            ["id", "Stable, readable row id: us-weekly-{week}-{ticker}, jp-weekly-{week}-{ticker}, physical-ai-{n}, neocloud-us-{n}, jp-sector-{ticker}."],
            ["ticker / company", "The company the condition is about."],
            ["population", "US Weekly Selection, JP Weekly Selection, Physical AI series, Neocloud US, Neocloud Japan, JP Sector Research, Submitted catalyst. Hit-rates are reported per population."],
            ["week_of", "Weekly rows: the Monday of the selection week."],
            ["question", "The condition being judged — what has to be disclosed for a hit."],
            ["fail_direction", "What a miss would look like, as written with the condition. Not judged on its own."],
            ["target_date", "The date the condition is judged on. When the company's own date was checked, that date (target_date_source_url is the IR page); otherwise the date written with the condition. Judging waits until 7 days after it."],
            ["result", "hit / partial / miss / na (the date passed and nothing could be judged) / pending / excluded (left the population before its date, e.g. delisted)."],
            ["judged_at", "When the result was given."],
            ["evidence_url", "The disclosure the result was judged against (first of evidence_urls)."],
            ["reasoning (paid)", "What was observed against the question."],
            ["evaluator (paid)", "Who judged: the model name, or the chat operation."],
            ["verdict_history (paid)", "Earlier results and why they were corrected. A result is never overwritten in place."],
          ]}
        />
      </Section>

      <Section id="financials" title="financials (paid)">
        <p className="text-[13px] text-slate-600">
          The latest disclosed figures, extracted mechanically from the filing by <code>npm run fetch:financials</code>{" "}
          (no API key, no model). A value the filing does not tag is null; nothing is derived or estimated.
        </p>
        <Fields
          rows={[
            ["US source", "SEC EDGAR XBRL companyfacts. latest_quarter (a ~90-day period) and latest_annual (~365 days): revenue, operating_income, net_income, eps_diluted."],
            ["US value fields", "value, unit, period_start, period_end, concept (us-gaap tag), form (10-Q / 10-K), filed, source_url (the filing on EDGAR)."],
            ["JP source", "TDnet 決算短信 XBRL (Summary). latest: revenue (売上高), operating_income (営業利益), ordinary_income (経常利益, JGAAP only), net_income (親会社株主に帰属する当期純利益)."],
            ["JP period", "Q1_YTD / Q2_YTD / Q3_YTD are cumulative from the start of the fiscal year, as 決算短信 report them; FY is the full year. basis: consolidated or non_consolidated."],
            ["JP value fields", "value (JPY), prior_value, yoy_pct, source_url (the 短信 PDF on TDnet), disclosed_at. TDnet keeps documents for about a month, so older source_url links may have expired."],
            ["prior_value / yoy_pct", "Same period one year earlier, as reported in the same filing. yoy_pct = (value − prior) / prior × 100, 1 dp; null when either is missing or prior ≤ 0."],
            ["null", "No filing in reach yet: a private company, a non-US filer without us-gaap facts, or a JP company with no 短信 since the extraction started."],
          ]}
        />
      </Section>

      <Section id="signals" title="signals (paid)">
        <Fields
          rows={[
            ["claim / direction", "One-line claim and its direction (bullish / bearish / structural)."],
            ["source / source_url / source_tier", "Where it came from: primary, secondary, opinion or leak."],
            ["verified", "false = not confirmed against a primary source. Kept, not used for selection."],
          ]}
        />
      </Section>

      <p className="text-xs text-slate-400">
        Informational only — not investment advice. No market prices are shown or used.
      </p>
    </div>
  );
}
