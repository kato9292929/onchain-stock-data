/**
 * Payers whose settled payment did not match what we asked for (wrong amount,
 * asset or recipient, found by the after-delivery check in lib/receipts.ts).
 * Their next payments are refused with 402 before any verify or settle.
 *
 * Kept in the same Upstash Redis as the receipts (key x402:blocked:<address>,
 * no expiry), else in memory for this instance (local runs, tests).
 */

export interface PayerBlocklist {
  has(address: string): Promise<boolean>;
  add(address: string, reason: string): Promise<void>;
}

export class MemoryBlocklist implements PayerBlocklist {
  private readonly m = new Map<string, string>();
  async has(a: string) {
    return this.m.has(a);
  }
  async add(a: string, reason: string) {
    this.m.set(a, reason);
  }
}

export class UpstashBlocklist implements PayerBlocklist {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  private async cmd(c: string[]): Promise<unknown> {
    const r = await this.fetchImpl(`${this.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify([c]),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`upstash ${r.status}`);
    const [reply] = (await r.json()) as Array<{ result?: unknown; error?: unknown }>;
    if (reply?.error) throw new Error(String(reply.error));
    return reply?.result;
  }
  async has(a: string) {
    return (await this.cmd(["EXISTS", `x402:blocked:${a}`])) === 1;
  }
  async add(a: string, reason: string) {
    await this.cmd(["SET", `x402:blocked:${a}`, JSON.stringify({ reason, at: new Date().toISOString() })]);
  }
}

let shared: PayerBlocklist | null = null;
export function payerBlocklist(): PayerBlocklist {
  if (!shared) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    shared = url && token ? new UpstashBlocklist(url, token) : new MemoryBlocklist();
  }
  return shared;
}
