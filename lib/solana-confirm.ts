/**
 * Did a settled Solana payment really pay us? Checked AFTER the paid body is
 * sent (the buyer is never held up by our RPC): the transaction the facilitator
 * returned from /settle is read with getTransaction and must
 *
 *   - exist and have succeeded (meta.err null)
 *   - move exactly `amount` of `asset` (USDC mint) into an account owned by `payTo`
 *
 *   ok          all of the above
 *   failed      the transaction is on chain with an error
 *   mismatch    it succeeded, but payTo did not receive `amount` of `asset`
 *   unverified  not found after the retries, or the RPC could not be asked
 *
 * RPC: SOLANA_RPC_URL, else the public endpoint. Free.
 */

export type SettlementCheck = "ok" | "failed" | "mismatch" | "unverified";

export interface SettlementResult {
  status: SettlementCheck;
  detail: string;
  /** The wallet whose USDC went down in this transaction, when one did. */
  payer: string | null;
  received: string | null;
}

const PUBLIC_RPC = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function solanaRpcUrl(network: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.SOLANA_RPC_URL) return env.SOLANA_RPC_URL;
  return network === DEVNET ? PUBLIC_RPC.devnet : PUBLIC_RPC.mainnet;
}

interface Balance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
interface ParsedTx {
  meta?: { err: unknown; preTokenBalances?: Balance[]; postTokenBalances?: Balance[] } | null;
  transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
}

/** Read one getTransaction (jsonParsed) result against what we asked for. Pure. */
export function readSettlement(tx: ParsedTx | null, want: { payTo: string; asset: string; amount: string }): SettlementResult {
  if (!tx || !tx.meta) return { status: "unverified", detail: "transaction not found", payer: null, received: null };
  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k.pubkey));
  const pre = new Map<number, Balance>();
  for (const b of tx.meta.preTokenBalances ?? []) pre.set(b.accountIndex, b);
  let received = 0n;
  let payer: string | null = null;
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.mint !== want.asset) continue;
    const delta = BigInt(b.uiTokenAmount.amount) - BigInt(pre.get(b.accountIndex)?.uiTokenAmount.amount ?? "0");
    if (b.owner === want.payTo || keys[b.accountIndex] === want.payTo) received += delta;
    else if (delta < 0n && b.owner) payer = b.owner;
  }
  if (tx.meta.err !== null && tx.meta.err !== undefined) {
    return { status: "failed", detail: `transaction error: ${JSON.stringify(tx.meta.err)}`, payer, received: received.toString() };
  }
  if (received !== BigInt(want.amount)) {
    return {
      status: "mismatch",
      detail: `payTo received ${received} of ${want.asset}, expected ${want.amount}`,
      payer,
      received: received.toString(),
    };
  }
  return { status: "ok", detail: "paid", payer, received: received.toString() };
}

export async function verifySettlement(
  signature: string,
  want: { payTo: string; asset: string; amount: string },
  opts: { rpcUrl: string; fetchImpl?: typeof fetch; attempts?: number; intervalMs?: number },
): Promise<SettlementResult> {
  const f = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 6;
  let last: SettlementResult = { status: "unverified", detail: "not asked", payer: null, received: null };
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await f(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const j = r.ok ? ((await r.json()) as { result?: ParsedTx | null; error?: unknown }) : null;
      last = !j || j.error
        ? { status: "unverified", detail: `rpc error: ${r.status} ${JSON.stringify(j?.error ?? "")}`, payer: null, received: null }
        : readSettlement(j.result ?? null, want);
    } catch (e) {
      last = { status: "unverified", detail: `rpc unreachable: ${e instanceof Error ? e.message : e}`, payer: null, received: null };
    }
    if (last.status !== "unverified") return last;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, opts.intervalMs ?? 2000));
  }
  return last;
}
