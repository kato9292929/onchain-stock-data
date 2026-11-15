/**
 * Is a settled Solana payment actually on chain? The facilitator's /settle
 * answer is not taken on its word: the transaction signature it returns is
 * looked up with getSignatureStatuses on our own RPC before any paid body is
 * handed out.
 *
 *   confirmed    commitment "confirmed" or "finalized", no error
 *   pending      not seen yet, or only "processed"
 *   failed       on chain with an error
 *   unavailable  the RPC could not be asked
 *
 * RPC: SOLANA_RPC_URL, else the public mainnet endpoint (devnet's for a devnet
 * network). Free; one call per paid response, a few retries while pending.
 */

export type SignatureState = "confirmed" | "pending" | "failed" | "unavailable";

const PUBLIC_RPC = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function solanaRpcUrl(network: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.SOLANA_RPC_URL) return env.SOLANA_RPC_URL;
  return network === DEVNET ? PUBLIC_RPC.devnet : PUBLIC_RPC.mainnet;
}

interface Options {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  intervalMs?: number;
}

/** One getSignatureStatuses answer, read. Pure. */
export function readSignatureStatus(json: unknown): SignatureState {
  const j = json as { error?: unknown; result?: { value?: Array<{ err?: unknown; confirmationStatus?: string } | null> } };
  if (!j || j.error || !j.result || !Array.isArray(j.result.value)) return "unavailable";
  const s = j.result.value[0];
  if (!s) return "pending";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending";
}

export async function signatureState(signature: string, opts: Options): Promise<SignatureState> {
  const f = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 5;
  let last: SignatureState = "unavailable";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await f(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      last = r.ok ? readSignatureStatus(await r.json()) : "unavailable";
    } catch {
      last = "unavailable";
    }
    if (last === "confirmed" || last === "failed") return last;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, opts.intervalMs ?? 800));
  }
  return last;
}
