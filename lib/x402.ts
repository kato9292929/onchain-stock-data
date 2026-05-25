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

export const PAY_TO_BASE = (process.env.WALLET_ADDRESS_BASE ??
  DEFAULT_BASE_PAY_TO) as `0x${string}`;

export const PAY_TO_SOLANA =
  process.env.WALLET_ADDRESS_SOLANA ?? DEFAULT_SOLANA_PAY_TO;

export const BASE_NETWORK: Network = "eip155:8453";
export const SOLANA_NETWORK: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

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

const facilitatorClient = new HTTPFacilitatorClient(buildFacilitatorConfig());

export const x402Server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(x402Server);
registerExactSvmScheme(x402Server);

/**
 * Build a v2 RouteConfig that advertises both Base USDC and Solana USDC
 * payment options for the given price. Clients pick whichever they want
 * to settle in.
 */
export function buildRouteConfig(
  price: string,
  description: string,
): RouteConfig {
  const accepts: PaymentOption[] = [
    {
      scheme: "exact",
      network: BASE_NETWORK,
      payTo: PAY_TO_BASE,
      price,
    },
    {
      scheme: "exact",
      network: SOLANA_NETWORK,
      payTo: PAY_TO_SOLANA,
      price,
    },
  ];
  return { accepts, description };
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
