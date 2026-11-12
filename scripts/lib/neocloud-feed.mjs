/**
 * Neocloud filings for the chat: what the listed neocloud companies filed, with
 * the passages that carry the numbers data/neocloud-metrics.json records.
 *
 *   US  SEC EDGAR submissions (data.sec.gov) by CIK: 8-K, 10-Q, 10-K, 6-K,
 *       20-F, 40-F. An 8-K / 6-K brings its Ex.99 press release along.
 *   JP  TDnet disclosures by 4-character code; PDFs through pdftotext.
 *
 * Network at export time only, free public sources, no keys. The text in an
 * excerpt is the document's own words, cut around the terms below; nothing is
 * summarised or computed here.
 */
import { get, pdfPages, tdnetIndex } from "../export-primary.mjs";

export const SEC_UA = "OnchainStockData research bot (osd.x402jp.com)";

/** The ten listed US members (data/themes.json neocloud-us). CIKs from sec.gov/files/company_tickers.json. */
export const NEOCLOUD_CIKS = {
  CRWV: "0001769628",
  NBIS: "0001513845",
  IREN: "0001878848",
  HUT: "0001964789",
  HIVE: "0001720424",
  WYFI: "0002042022",
  APLD: "0001144879",
  CIFR: "0001819989",
  WULF: "0001083301",
  CORZ: "0001839341",
};

const FORMS = /^(8-K|10-Q|10-K|6-K|20-F|40-F)(\/A)?$/;
const PERIODIC = /^(10-Q|10-K|20-F|40-F)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── text ──────────────────────────────────────────────────────────────────

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", bull: "•" };

/** HTML (EDGAR documents, inline XBRL) to plain text: one table row or block per line. Pure. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/(\s*\|\s*)+/g, " | ").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** What a neocloud number is called in a filing. */
export const US_TERMS = [
  /\bMW\b/, /megawatt/i, /gigawatt/i, /\bGW\b/, /contracted (power|capacity)/i, /energi[sz]ed/i, /critical IT/i,
  /active power/i, /backlog/i, /remaining performance obligation/i, /\bRPO\b/, /guidance/i, /outlook/i,
  /capital expenditure/i, /\bcapex\b/i, /notes due/i, /senior (secured )?notes/i, /convertible/i, /credit (facility|agreement)/i,
  /term loan/i, /delayed draw/i, /at-the-market/i, /\bATM\b/, /private placement/i, /contract value/i,
  /(master services|colocation|lease) agreement/i, /\bcustomer\b/i, /annuali[sz]ed run-rate/i, /\bARR\b/,
];
export const JP_TERMS = [/MW/, /メガワット/, /GPU/, /受注残/, /受注/, /業績予想/, /通期/, /設備投資/, /借入/, /社債/, /増資/, /契約/, /データセンター/, /クラウド/, /稼働/];

/** Legal and logistics text that names the terms without stating a number. */
const BOILERPLATE = /forward-looking|safe harbor|Regulation FD|webcast|conference call|risk factors|risks and uncertainties|without unreasonable effort/i;

/**
 * The passages that carry the numbers: lines with a term and a digit, with the
 * line before and after for context, best first, kept in document order. Pure.
 */
export function excerpt(text, terms = US_TERMS, maxChars = 5000, lineChars = 600) {
  const lines = String(text ?? "").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!/\d/.test(l) || BOILERPLATE.test(l)) continue;
    const score = terms.reduce((n, re) => n + (re.test(l) ? 1 : 0), 0);
    if (score > 0) hits.push({ i, score });
  }
  // Windows of [i-1, i+1], merged where they touch.
  const windows = [];
  for (const h of hits) {
    const w = { from: Math.max(0, h.i - 1), to: Math.min(lines.length - 1, h.i + 1), score: h.score };
    const last = windows.at(-1);
    if (last && w.from <= last.to + 1) {
      last.to = Math.max(last.to, w.to);
      last.score += w.score;
    } else windows.push(w);
  }
  const ranked = [...windows].sort((a, b) => b.score - a.score);
  const keep = [];
  let used = 0;
  for (const w of ranked) {
    const body = lines
      .slice(w.from, w.to + 1)
      .map((l) => (l.length > lineChars ? `${l.slice(0, lineChars)}…` : l))
      .join("\n");
    if (used + body.length > maxChars) continue;
    keep.push({ ...w, body });
    used += body.length;
  }
  return keep.sort((a, b) => a.from - b.from).map((w) => w.body);
}

// ── EDGAR ─────────────────────────────────────────────────────────────────

async function sec(url, as = "json") {
  const r = await fetch(url, { headers: { "user-agent": SEC_UA }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  await sleep(150); // EDGAR asks for at most 10 requests a second
  return as === "json" ? r.json() : r.text();
}

const archive = (cik, accn) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;

/** The submissions list as filing rows, newest first. Pure. */
export function filingsFromSubmissions(ticker, cik, json, { from, to }) {
  const f = json?.filings?.recent ?? {};
  const out = [];
  for (let i = 0; i < (f.form ?? []).length; i += 1) {
    const filed = f.filingDate[i];
    if (filed < from || filed > to || !FORMS.test(f.form[i])) continue;
    const items = f.items?.[i] ? String(f.items[i]) : "";
    out.push({
      ticker,
      market: "US",
      form: f.form[i],
      filed_at: filed,
      report_date: f.reportDate?.[i] || null,
      accession: f.accessionNumber[i],
      items,
      title: [f.form[i], f.primaryDocDescription?.[i], items ? `Items ${items}` : ""].filter(Boolean).join(" · "),
      url: `${archive(cik, f.accessionNumber[i])}/${f.primaryDocument[i]}`,
      folder: archive(cik, f.accessionNumber[i]),
    });
  }
  return out.sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1));
}

export async function edgarFilings(ticker, { from, to }) {
  const cik = NEOCLOUD_CIKS[ticker];
  if (!cik) return [];
  return filingsFromSubmissions(ticker, cik, await sec(`https://data.sec.gov/submissions/CIK${cik}.json`), { from, to });
}

/** Ex.99 documents listed on a filing's -index.htm page (by its Type column). Pure. */
export function exhibitsFromIndex(html, folder) {
  const out = [];
  for (const tr of String(html ?? "").replace(/\n/g, " ").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const type = cells[3]?.replace(/<[^>]+>|&nbsp;/g, "").trim() ?? "";
    const href = cells[2]?.match(/href="([^"]+)"/)?.[1] ?? "";
    const name = href.replace(/^\/ix\?doc=/, "").split("/").pop();
    if (/^EX-99/i.test(type) && /\.html?$/i.test(name)) out.push({ label: type.toUpperCase(), url: `${folder}/${name}` });
  }
  return out;
}

/** The filing's documents worth reading: the primary document and its Ex.99 exhibits. */
async function edgarDocuments(filing) {
  const docs = [{ label: filing.form, url: filing.url }];
  if (/^(8-K|6-K)/.test(filing.form)) {
    try {
      const html = await sec(`${filing.folder}/${filing.accession}-index.htm`, "text");
      docs.push(...exhibitsFromIndex(html, filing.folder));
    } catch {
      // the primary document alone
    }
  }
  return docs;
}

// ── TDnet ─────────────────────────────────────────────────────────────────

const JP_SKIP = /自己株式|株主優待|役員|人事|定款|株式報酬|ストックオプション|招集|コーポレート・ガバナンス|主要株主|剰余金の配当|配当予想|新株予約権の行使|行使期間満了/;

export async function tdnetFilings(codes, { from, to }) {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
  const by = await tdnetIndex(new Set(codes), to, days);
  const out = [];
  for (const [code, list] of by) {
    for (const r of list) {
      if (r.date < from || r.date > to || !r.pdf_url) continue;
      out.push({ ticker: code, market: "JP", form: "TDnet", filed_at: r.date, title: r.title, url: r.pdf_url, skip: JP_SKIP.test(r.title) });
    }
  }
  return out.sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1));
}

// ── one feed ──────────────────────────────────────────────────────────────

/**
 * Filings of the window with their excerpts.
 *   mode "window"   every filing filed in [from, to]
 *   mode "quarter"  per US company: the latest periodic report (10-Q / 10-K /
 *                   20-F / 40-F) and every 8-K / 6-K since `from`; per JP
 *                   company: the latest 決算短信 and its same-day 説明資料
 */
export async function collectFeed({ companies, from, to, mode = "window", log = () => {} }) {
  const us = companies.filter((c) => c.market === "US" && NEOCLOUD_CIKS[c.ticker]);
  const jp = companies.filter((c) => c.market === "JP");
  const filings = [];
  const errors = [];

  for (const c of us) {
    try {
      let list = await edgarFilings(c.ticker, { from: mode === "quarter" ? "2000-01-01" : from, to });
      if (mode === "quarter") {
        const periodic = list.find((f) => PERIODIC.test(f.form));
        list = [
          ...(periodic ? [periodic] : []),
          ...list.filter((f) => !PERIODIC.test(f.form) && f.filed_at >= from),
        ];
      }
      for (const f of list) {
        const docs = [];
        for (const d of await edgarDocuments(f)) {
          try {
            const text = htmlToText(await sec(d.url, "text"));
            const cap = PERIODIC.test(f.form) ? 9000 : /^EX-99/.test(d.label) ? 7000 : 2000;
            docs.push({ ...d, excerpts: excerpt(text, US_TERMS, cap) });
          } catch (e) {
            docs.push({ ...d, error: e.message });
          }
        }
        filings.push({ ...f, company: c.company, docs });
      }
      log(`${c.ticker}: ${list.length} filings`);
    } catch (e) {
      errors.push(`${c.ticker}: ${e.message}`);
    }
  }

  if (jp.length) {
    try {
      let list = await tdnetFilings(jp.map((c) => c.ticker), { from: mode === "quarter" ? addDaysIso(to, -45) : from, to });
      if (mode === "quarter") {
        const keep = [];
        for (const c of jp) {
          const mine = list.filter((f) => f.ticker === c.ticker);
          const tanshin = mine.find((f) => /決算短信/.test(f.title) && !/訂正/.test(f.title));
          keep.push(
            ...mine.filter(
              (f) => (tanshin && f.filed_at === tanshin.filed_at && !f.skip) || (f.filed_at >= from && !f.skip && f !== tanshin),
            ),
          );
        }
        list = keep;
      }
      for (const f of list) {
        const c = jp.find((x) => x.ticker === f.ticker);
        if (f.skip) {
          filings.push({ ...f, company: c?.company ?? f.ticker, docs: [] });
          continue;
        }
        try {
          const pages = pdfPages(await get(f.url, "buf"), f.title, f.url);
          const text = pages.map((p) => `[p.${p.page}]\n${p.text}`).join("\n");
          const cap = /決算短信|説明資料|補足資料|プレゼンテーション/.test(f.title) ? 7000 : 3000;
          filings.push({ ...f, company: c?.company ?? f.ticker, docs: [{ label: "PDF", url: f.url, excerpts: excerpt(text, JP_TERMS, cap, 400) }] });
        } catch (e) {
          filings.push({ ...f, company: c?.company ?? f.ticker, docs: [{ label: "PDF", url: f.url, error: e.message }] });
        }
      }
      log(`JP: ${list.length} disclosures`);
    } catch (e) {
      errors.push(`TDnet: ${e.message}`);
    }
  }
  return { from, to, mode, filings, errors, companies };
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── rendering ─────────────────────────────────────────────────────────────

const fence = (s) => `\`\`\`text\n${String(s).replace(/```/g, "ˋˋˋ")}\n\`\`\``;

/** Markdown for a feed: per company, each filing with its URL and excerpts. Pure. */
export function renderFeed(feed, { heading, intro = [] }) {
  const L = [heading, ""];
  L.push(...intro);
  L.push(
    `- 期間：${feed.from} 〜 ${feed.to}。取得元：米国は SEC EDGAR（8-K・10-Q・10-K・6-K・20-F・40-F、8-K / 6-K は Ex.99 も）、日本は TDnet。`,
    "- 抜粋は書類の文章そのもの（数字と用語を含む行と、その前後の行）。表は「 | 」で区切った 1 行。",
    "- 返答：数字は `metrics`、数字にならない出来事は `signals`（ops/chat-schema.md §6・§3）。`source_url` には下の書類の URL をそのまま使う。",
    "",
  );
  if (feed.errors?.length) {
    L.push("取得できなかったもの：", ...feed.errors.map((e) => `- ${e}`), "");
  }
  const byTicker = new Map();
  for (const f of feed.filings) byTicker.set(f.ticker, [...(byTicker.get(f.ticker) ?? []), f]);
  const quiet = feed.companies.filter((c) => (c.market === "JP" || NEOCLOUD_CIKS[c.ticker]) && !byTicker.has(c.ticker));
  if (byTicker.size === 0) L.push("この期間の開示はありません。", "");
  for (const c of feed.companies) {
    const list = byTicker.get(c.ticker);
    if (!list) continue;
    L.push(`#### ${c.ticker} ${c.company}（${c.market}）`, "");
    for (const f of list) {
      L.push(`- **${f.title}**（${f.filed_at}${f.report_date ? `・期末 ${f.report_date}` : ""}） ${f.url}`);
      if (!f.docs?.length) {
        L.push("  - 抜粋なし（事業の数字を含まない種類の開示）");
        continue;
      }
      for (const d of f.docs) {
        if (d.url !== f.url) L.push(`  - ${d.label}： ${d.url}`);
        if (d.error) L.push(`  - 取得できず：${d.error}`);
        else if (!d.excerpts?.length) L.push("  - 該当する箇所なし");
      }
      const parts = f.docs.flatMap((d) => (d.excerpts ?? []).map((e) => (f.docs.length > 1 ? `[${d.label}]\n${e}` : e)));
      if (parts.length) L.push("", fence(parts.join("\n\n")), "");
    }
    L.push("");
  }
  if (quiet.length) L.push(`この期間に開示がない会社：${quiet.map((c) => `${c.ticker} ${c.company}`).join("、")}`, "");
  const unlisted = feed.companies.filter((c) => c.market === "US" && !NEOCLOUD_CIKS[c.ticker]);
  if (unlisted.length) {
    L.push(
      `未上場（${unlisted.map((c) => c.ticker).join("・")}）は提出書類がないので、会社の公式発表から取れる数字だけを返す（自動では集めていない）。`,
      "",
    );
  }
  return L.join("\n");
}

/** Filing metadata kept in data/neocloud-filings.json (no excerpts). Pure. */
export function filingIndexRows(feed) {
  return feed.filings.map((f) => ({ ticker: f.ticker, market: f.market, form: f.form, title: f.title, filed_at: f.filed_at, url: f.url }));
}

/** Merge new filing rows into the kept index, newest first, `keepDays` long. Pure. */
export function mergeFilingIndex(file, rows, today, keepDays = 120) {
  const cut = addDaysIso(today, -keepDays);
  const by = new Map((file?.filings ?? []).map((r) => [r.url, r]));
  for (const r of rows) by.set(r.url, r);
  return {
    note:
      "Filing metadata (form, date, URL) of the neocloud companies, found by export:chat on SEC EDGAR and TDnet. " +
      "Metadata only; the numbers are in data/neocloud-metrics.json.",
    updated_at: today,
    filings: [...by.values()].filter((r) => r.filed_at >= cut).sort((a, b) => (a.filed_at < b.filed_at ? 1 : a.filed_at > b.filed_at ? -1 : a.ticker < b.ticker ? -1 : 1)),
  };
}
