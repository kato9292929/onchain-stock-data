import {
  HTTPFacilitatorClient,
  x402ResourceServer,
} from "@x402/core/server";
import type {
  FacilitatorConfig,
  RouteConfig,
} from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { createFacilitatorConfig, facilitator } from "@coinbase/x402";

const DEFAULT_BASE_PAY_TO = "0xC67d94504696960bA0f2e7C3FeE703950734c00A";
const DEFAULT_SOLANA_PAY_TO = "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf";
const DEFAULT_PUBLIC_BASE_URL = "https://osd-coral.vercel.app";

export const PAY_TO_BASE = (process.env.WALLET_ADDRESS_BASE ??
  DEFAULT_BASE_PAY_TO) as `0x${string}`;

// Solana receive address. SOLANA_RECEIVE_ADDRESS is the canonical Phase-Solana
// env; WALLET_ADDRESS_SOLANA is kept as a backward-compatible fallback.
export const PAY_TO_SOLANA =
  process.env.SOLANA_RECEIVE_ADDRESS ??
  process.env.WALLET_ADDRESS_SOLANA ??
  DEFAULT_SOLANA_PAY_TO;

export const BASE_NETWORK: Network = "eip155:8453";
export const SOLANA_NETWORK: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// USDC contract / mint addresses on each chain. Surfaced in the
// `/.well-known/x402.json` descriptor so directory crawlers (x402scan, Pay.sh)
// can confirm what asset each accept leg settles in without re-deriving from
// `network`.
export const ASSET_BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const ASSET_SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Canonical origin used to build absolute `resource` URLs in v2 accept legs
// and in the discovery JSON. `X402_PUBLIC_BASE_URL` lets a self-hoster point
// the descriptor at their own deployment without code changes.
export const PUBLIC_BASE_URL = (
  process.env.X402_PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL
).replace(/\/$/, "");

export function resourceUrl(pathTemplate: string): string {
  const path = pathTemplate.startsWith("/") ? pathTemplate : `/${pathTemplate}`;
  return `${PUBLIC_BASE_URL}${path}`;
}

/**
 * EVM (Base) facilitator config. CDP (api.cdp.coinbase.com) verifies Base but
 * NOT Solana — its `getSupported()` advertises EVM kinds only. So Base payments
 * keep flowing through CDP exactly as before.
 */
function buildFacilitatorConfig(): FacilitatorConfig {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (apiKeyId && apiKeySecret) {
    return createFacilitatorConfig(apiKeyId, apiKeySecret);
  }
  const url = process.env.FACILITATOR_URL;
  if (url && /^https?:\/\//.test(url)) {
    return { url };
  }
  return facilitator;
}

/**
 * Build the facilitator client array for the resource server.
 *
 * The SDK already ships a full SVM (Solana) verify/settle scheme
 * (`registerExactSvmScheme`, registered below); the only missing piece was a
 * facilitator that advertises `solana:*` in `getSupported()`. Since
 * `x402ResourceServer` accepts an array of clients and merges their supported
 * networks (earlier clients win on conflicts), we append a Solana facilitator
 * client when `SOLANA_FACILITATOR_URL` is configured.
 *
 * When that env is unset, the array is just the CDP/EVM client — behaviour is
 * byte-for-byte identical to before (Base-only real verification), so this is a
 * safe, regression-free addition. The owner injects a Solana x402 facilitator
 * URL (e.g. PayAI) at deploy time to turn on real Solana verification.
 */
function buildFacilitatorClients(): HTTPFacilitatorClient[] {
  const clients: HTTPFacilitatorClient[] = [
    new HTTPFacilitatorClient(buildFacilitatorConfig()),
  ];

  const solUrl = process.env.SOLANA_FACILITATOR_URL;
  if (solUrl && /^https?:\/\//.test(solUrl)) {
    const config: FacilitatorConfig = { url: solUrl.replace(/\/$/, "") };
    clients.push(new HTTPFacilitatorClient(config));
  }

  return clients;
}

/** True when a dedicated Solana facilitator is configured (real SVM verify). */
export function isSolanaFacilitatorConfigured(): boolean {
  const u = process.env.SOLANA_FACILITATOR_URL;
  return !!u && /^https?:\/\//.test(u);
}

export const x402Server = new x402ResourceServer(buildFacilitatorClients());
registerExactEvmScheme(x402Server);
registerExactSvmScheme(x402Server);

/**
 * Build a v2 RouteConfig that advertises both Base USDC and Solana USDC
 * payment options for the given price. Clients pick whichever they want
 * to settle in.
 *
 * `resourcePath` (e.g. `/api/stocks/:ticker`) is echoed:
 *   - at the top level as `RouteConfig.resource` so the v2 `PaymentRequired`
 *     response carries `resource.url` even when the request URL alone is
 *     ambiguous (proxies, rewrites);
 *   - per accept leg as `extra.resource` so spend-map / receipt matchers can
 *     bind a settled payment back to the specific endpoint that priced it,
 *     without needing to re-parse the top-level resource for every leg.
 */
export function buildRouteConfig(
  price: string,
  description: string,
  resourcePath: string,
): RouteConfig {
  const resource = resourceUrl(resourcePath);
  const accepts: PaymentOption[] = [
    {
      scheme: "exact",
      network: BASE_NETWORK,
      payTo: PAY_TO_BASE,
      price,
      extra: { resource },
    },
    {
      scheme: "exact",
      network: SOLANA_NETWORK,
      payTo: PAY_TO_SOLANA,
      price,
      extra: { resource },
    },
  ];
  return { accepts, description, resource };
}

/**
 * Internal-auth bypass: callers that present the shared INTERNAL_API_KEY in
 * the `X-Internal-Key` header skip payment entirely. Useful for our own
 * backend / AA agents that already pay for compute another way.
 */
export function isInternalAuthed(req: {
  headers: { get(name: string): string | null };
}): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-internal-key");
  return !!provided && provided === expected;
}
