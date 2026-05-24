export interface SecFiling {
  source: "sec-edgar" | "websearch-fallback" | "unavailable";
  ticker: string;
  filings: Array<{
    form: string;
    filed_date: string;
    url: string;
    summary: string;
  }>;
  notes?: string;
}

async function fetchSecPrimary(ticker: string): Promise<SecFiling | null> {
  const url = `https://data.sec.gov/submissions/CIK${ticker}.json`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Onchain Stock Data Analyst (hello@x402jp.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      name?: string;
      filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[] } };
    };
    const recent = json.filings?.recent;
    if (!recent?.form) return null;
    const filings = recent.form.slice(0, 5).map((form, idx) => ({
      form,
      filed_date: recent.filingDate?.[idx] ?? "",
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=${form}`,
      summary: `${form} filing for ${json.name ?? ticker}`,
    }));
    return { source: "sec-edgar", ticker, filings };
  } catch {
    return null;
  }
}

export async function fetchSecFilings(ticker: string): Promise<SecFiling> {
  const direct = await fetchSecPrimary(ticker);
  if (direct) return direct;
  return {
    source: "unavailable",
    ticker,
    filings: [],
    notes:
      "SEC EDGAR could not be reached from this runtime (network policy or rate limit). " +
      "Consider a WebSearch fallback at request time or scheduling a separate cron job that " +
      "writes data/sec-cache/{ticker}.json.",
  };
}
