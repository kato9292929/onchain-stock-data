import {
  HTTPFacilitatorClient,
  x402ResourceServer,
} from "@x402/core/server";
import type {
  FacilitatorClient,
  FacilitatorConfig,
  RouteConfig,
} from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { PaymentOption } from "@x402/core/http";
import type { Network, Price } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { createFacilitatorConfig, facilitator } from "@coinbase/x402";
import {
  createFacilitatorConfig as createPayAIFacilitatorConfig,
} from "@payai/facilitator";

const DEFAULT_BASE_PAY_TO = "0xC67d94504696960bA0f2e7C3FeE703950734c00A";
const DEFAULT_SOLANA_PAY_TO = "4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf";
const DEFAULT_PUBLIC_BASE_URL = "https://osd.x402jp.com";

export const PAY_TO_BASE = (process.env.WALLET_ADDRESS_BASE ??
  DEFAULT_BASE_PAY_TO) as `0x${string}`;

// Solana receive address. SOLANA_RECEIVE_ADDRESS is the canonical Phase-Solana
// env; WALLET_ADDRESS_SOLANA is kept as a backward-compatible fallback.
export const PAY_TO_SOLANA =
  process.env.SOLANA_RECEIVE_ADDRESS ??
  process.env.WALLET_ADDRESS_SOLANA ??
  DEFAULT_SOLANA_PAY_TO;

export const BASE_NETWORK: Network = "eip155:8453";

// Solana network (CAIP-2). Defaults to mainnet-beta. `X402_SOLANA_NETWORK` lets
// a preview deployment advertise devnet (solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1…)
// for the one-shot devnet wiring smoke (§4) without changing production, which
// stays mainnet by default.
export const SOLANA_NETWORK: Network = (process.env.X402_SOLANA_NETWORK ??
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") as Network;

// USDC contract / mint addresses on each chain. Surfaced in the
// `/.well-known/x402.json` descriptor so directory crawlers (x402scan, Pay.sh)
// can confirm what asset each accept leg settles in without re-deriving from
// `network`.
export const ASSET_BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Solana USDC-SPL mint. Mainnet (Circle) is the default — confirmed canonical
// value. `SOLANA_USDC_MINT` overrides it for a devnet preview (Circle devnet
// USDC = 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU).
export const ASSET_SOLANA_USDC =
  process.env.SOLANA_USDC_MINT ??
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
 * CDP (Base/EVM) facilitator config — UNCHANGED.
 * Priority: CDP_API_KEY → FACILITATOR_URL → @coinbase/x402 anonymous default.
 * This is the verify/settle path for Base (eip155:8453) and must not change.
 * CDP verifies Base only; Solana is handled by the PayAI client below.
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

const cdpFacilitatorClient = new HTTPFacilitatorClient(buildFacilitatorConfig());

/**
 * Build the PayAI (Solana) facilitator client, or null if construction fails.
 *
 * Official PayAI wiring (verified against @payai/facilitator@2.4.x types):
 * `createFacilitatorConfig()` returns a FacilitatorConfig pointing at
 * https://facilitator.payai.network with automatic JWT auth when
 * PAYAI_API_KEY_ID / PAYAI_API_KEY_SECRET are set (free tier works without).
 * It is passed to the same HTTPFacilitatorClient the CDP path uses.
 *
 * Wrapped in try/catch so a missing package or a failed config build does not
 * take the whole app down — but it is NOT a silent degrade to CDP: the scoping
 * below gives CDP no claim on Solana, so the paid routes fail loudly instead of
 * being settled by a facilitator that was never meant to serve them.
 */
function buildPayAIFacilitatorClient(): HTTPFacilitatorClient | null {
  try {
    const config = createPayAIFacilitatorConfig(
      process.env.PAYAI_API_KEY_ID,
      process.env.PAYAI_API_KEY_SECRET,
    );
    return new HTTPFacilitatorClient(config);
  } catch (err) {
    // error, not warn: every paid mainnet route settles on Solana, so losing
    // this client means the paid surface cannot be served. It used to read
    // "Base unaffected", which was true when routes were dual-leg and is not
    // any more. Kept non-fatal so the free/HTML surface still boots, but the
    // paid routes will answer 503 payment_unavailable rather than pretend.
    console.error(
      `[x402] PayAI facilitator unavailable — Solana cannot be verified or settled, ` +
        `so every paid route will return 503 payment_unavailable: ${err}`,
    );
    return null;
  }
}

const payaiFacilitatorClient = buildPayAIFacilitatorClient();

/** True when the PayAI (Solana) facilitator client was constructed. */
export const isPayAISolanaEnabled = payaiFacilitatorClient !== null;

/** A network id belongs to the EVM family (CAIP-2 `eip155:*`, or the v1 alias). */
function isEvmNetwork(network: string): boolean {
  return network === "base" || network.startsWith("eip155:");
}

/** A network id belongs to the Solana family (CAIP-2 `solana:*`, or the v1 alias). */
function isSolanaNetwork(network: string): boolean {
  return network === "solana" || network.startsWith("solana:");
}

/**
 * Restrict a facilitator to the networks we actually want it to serve.
 *
 * `x402ResourceServer.initialize()` asks every client what it supports and
 * keeps the FIRST client that claims a given (version, network, scheme) —
 * `if (!responseNetworkMap.has(kind.scheme))` in @x402/core 2.13.0. That makes
 * the ARRAY ORDER decide who settles each chain, based on whatever each
 * facilitator happens to advertise.
 *
 * That is too implicit to rely on. CDP advertises Solana as well as EVM, so
 * listing it first silently hands it `solana:*` too — and a CDP account past
 * its free tier then fails settlement AFTER the buyer has signed, which
 * surfaces to the buyer as an opaque 402 with an empty body. The previous
 * comment here asserted "CDP verifies Base only"; that was an assumption about
 * getSupported(), never a check.
 *
 * So we state the split in code instead of inferring it from order: CDP serves
 * EVM, PayAI serves Solana, whatever either one claims.
 */
function scopeToNetworks(
  inner: FacilitatorClient,
  label: string,
  allow: (network: string) => boolean,
): FacilitatorClient {
  return {
    async getSupported(): Promise<SupportedResponse> {
      const supported = await inner.getSupported();
      const kinds = supported.kinds.filter((kind) => allow(String(kind.network)));
      const dropped = supported.kinds.length - kinds.length;
      if (dropped > 0) {
        console.info(
          `[x402] ${label} facilitator scoped: ignoring ${dropped} advertised kind(s) outside its assigned networks`,
        );
      }
      return { ...supported, kinds };
    },
    verify(
      paymentPayload: PaymentPayload,
      paymentRequirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
      return inner.verify(paymentPayload, paymentRequirements);
    },
    settle(
      paymentPayload: PaymentPayload,
      paymentRequirements: PaymentRequirements,
    ): Promise<SettleResponse> {
      return inner.settle(paymentPayload, paymentRequirements);
    },
  };
}

/**
 * Facilitator clients, each scoped to its own chain family. Order no longer
 * carries meaning: the scopes do not overlap, so neither client can take the
 * other's networks regardless of what it advertises.
 *
 * If PayAI could not be built, Solana has NO facilitator rather than silently
 * falling through to CDP. That is deliberate: every paid mainnet route is
 * Solana-only, so a missing PayAI client means those routes cannot be served
 * at all. The SDK then reports the network as unsupported, which the route
 * wrapper turns into an explicit 503 `payment_unavailable` + Retry-After —
 * a buyer can act on that, unlike an empty 402 after it has already signed.
 */
const facilitatorClients: FacilitatorClient[] = [
  scopeToNetworks(cdpFacilitatorClient, "CDP", isEvmNetwork),
  ...(payaiFacilitatorClient
    ? [scopeToNetworks(payaiFacilitatorClient, "PayAI", isSolanaNetwork)]
    : []),
];

export const x402Server = new x402ResourceServer(facilitatorClients);
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
/**
 * Atomic USDC price on Solana. `amount` is base units (USDC has 6 decimals,
 * so 100 = 0.0001 USDC) and `asset` is the SPL mint. Passing this exact
 * AssetAmount as a route price makes the 402 challenge advertise
 * maxAmountRequired="100" verbatim, rather than deriving it from a "$…" string.
 */
export function solanaUsdcUnits(baseUnits: string | number): Price {
  return { amount: String(baseUnits), asset: ASSET_SOLANA_USDC };
}

/**
 * Canonical per-call price for osd's PAID mainnet endpoints
 * (`/api/catalyst/:ticker`, `/api/edinet/:code`): settled `exact` in USDC on
 * Solana. Single source of truth — routes and their descriptors reference these
 * fields and never re-literal the amount, so the price is changed in one place.
 *
 * `base_units` is atomic USDC (6 decimals) → "1000" = 0.001 USDC. Kept above the
 * facilitator's dust floor (a sub-0.001 charge is worth less than sponsored SOL
 * gas, so the facilitator refuses it). The testnet `signal_get` twin
 * (`/api/testnet/signal`, Base Sepolia) prices separately — see
 * `X402_TESTNET_SIGNAL_PRICE` — and is NOT covered by this constant.
 */
export const PER_CALL_PRICE = {
  base_units: "1000",
  usdc: 0.001,
  asset: "USDC",
  network: "solana",
  scheme: "exact",
} as const;

/**
 * Safety valve for the micro-priced Solana endpoints: assert the built route
 * config charges EXACTLY one Solana USDC accept at `units` base units. Throws
 * at module load (route import) if the network, mint, or amount ever drift —
 * so a misconfigured endpoint fails closed (500 on every request) instead of
 * silently charging the wrong network/asset/amount.
 */
export function assertSolanaExactUsdc(rc: RouteConfig, units: string): void {
  const raw = rc.accepts;
  const accepts: PaymentOption[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (accepts.length !== 1) {
    throw new Error(`[x402 safety] expected exactly 1 accept, got ${accepts.length}`);
  }
  const a = accepts[0];
  if (a.network !== SOLANA_NETWORK) {
    throw new Error(`[x402 safety] network must be ${SOLANA_NETWORK}, got ${a.network}`);
  }
  const price = a.price;
  if (
    typeof price !== "object" ||
    price === null ||
    (price as { amount?: unknown }).amount !== units ||
    (price as { asset?: unknown }).asset !== ASSET_SOLANA_USDC
  ) {
    throw new Error(
      `[x402 safety] price must be { amount: "${units}", asset: ${ASSET_SOLANA_USDC} }, got ${JSON.stringify(price)}`,
    );
  }
}

export function buildRouteConfig(
  price: Price,
  description: string,
  resourcePath: string,
): RouteConfig {
  const resource = resourceUrl(resourcePath);
  // ORDER IS LOAD-BEARING. @x402/core's default client selector is
  // `(x402Version, accepts) => accepts[0]` (client/index.mjs:31), so any buyer
  // that does not pass its own selector pays on whichever leg we list first —
  // it never "picks the chain it can settle". This config used to put Base
  // first, which is how AA ended up signing Base payments it could not settle
  // once CDP was quota-blocked (the failure looked like an opaque 402 with an
  // empty body, after the signature). Solana leads: it is the rail we actually
  // sell on. If Base is ever restored as a real option, keep the most reliable
  // leg first and revisit this comment.
  const accepts: PaymentOption[] = [
    {
      scheme: "exact",
      network: SOLANA_NETWORK,
      payTo: PAY_TO_SOLANA,
      price,
      extra: { resource },
    },
    {
      scheme: "exact",
      network: BASE_NETWORK,
      payTo: PAY_TO_BASE,
      price,
      extra: { resource },
    },
  ];
  return { accepts, description, resource };
}

/**
 * Build a v2 RouteConfig that advertises ONLY the Solana USDC payment option.
 *
 * Same scheme/network/payTo/extra as the Solana leg of `buildRouteConfig` —
 * the Solana accept is byte-identical; we just omit the Base (EVM) leg. Used
 * by the handful of endpoints (/api/ipo, /api/holders, /api/liquidity) that
 * should be settled on Solana only, so AA cannot pick the Base accept. All
 * other paid endpoints keep the dual-leg `buildRouteConfig`.
 *
 * NOTE (2026-09): every paid mainnet route now uses this Solana-only builder —
 * AA, the only buyer, holds no EVM signer, and advertising a Base leg backed
 * by a quota-blocked facilitator fails AFTER the buyer signs. See
 * docs/facilitator-design.md §4. `buildRouteConfig` is kept for the day Base
 * comes back.
 */
export function buildSolanaOnlyRouteConfig(
  price: Price,
  description: string,
  resourcePath: string,
): RouteConfig {
  const resource = resourceUrl(resourcePath);
  const accepts: PaymentOption[] = [
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

// ── Testnet (Base Sepolia) demo path ──────────────────────────────────────
// A SEPARATE x402 stack for the MCP "agent pays" demo. It never touches the
// mainnet server/config above: different network (eip155:84532), a different
// facilitator (the free public x402.org one, which supports base-sepolia
// exact — verified 2026-08-26), and its own resource server instance. Nothing
// here changes how the production Base/Solana endpoints settle.

/** Base Sepolia CAIP-2 id (testnet). */
export const BASE_SEPOLIA_NETWORK: Network = "eip155:84532";

/** Base Sepolia USDC (Circle testnet mint). */
export const ASSET_BASE_SEPOLIA_USDC =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Testnet receive address. Defaults to the mainnet Base payTo (same EVM
 * address is valid on Base Sepolia); override with X402_TESTNET_PAY_TO. */
export const PAY_TO_BASE_SEPOLIA = (process.env.X402_TESTNET_PAY_TO ??
  PAY_TO_BASE) as `0x${string}`;

/** Public, keyless facilitator that verifies/settles Base Sepolia exact. */
export const TESTNET_FACILITATOR_URL =
  process.env.X402_TESTNET_FACILITATOR_URL ?? "https://x402.org/facilitator";

const testnetFacilitatorClient = new HTTPFacilitatorClient({
  url: TESTNET_FACILITATOR_URL,
});

/** Dedicated testnet resource server (Base Sepolia only). */
export const x402TestnetServer = new x402ResourceServer([
  testnetFacilitatorClient,
]);
registerExactEvmScheme(x402TestnetServer);

/**
 * Build a v2 RouteConfig advertising ONLY the Base Sepolia USDC accept, for
 * the testnet demo endpoints. Same exact scheme as mainnet, different network.
 */
export function buildTestnetRouteConfig(
  price: Price,
  description: string,
  resourcePath: string,
): RouteConfig {
  const resource = resourceUrl(resourcePath);
  const accepts: PaymentOption[] = [
    {
      scheme: "exact",
      network: BASE_SEPOLIA_NETWORK,
      payTo: PAY_TO_BASE_SEPOLIA,
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
