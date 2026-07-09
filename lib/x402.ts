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
import {
  createFacilitatorConfig as createPayAIFacilitatorConfig,
} from "@payai/facilitator";

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
 * Wrapped in try/catch so that, if the package is missing or config build
 * throws, we degrade to CDP-only (Base) and never break the existing path.
 */
function buildPayAIFacilitatorClient(): HTTPFacilitatorClient | null {
  try {
    const config = createPayAIFacilitatorConfig(
      process.env.PAYAI_API_KEY_ID,
      process.env.PAYAI_API_KEY_SECRET,
    );
    return new HTTPFacilitatorClient(config);
  } catch (err) {
    console.warn(
      `[x402] PayAI facilitator unavailable — Solana verification disabled, Base unaffected: ${err}`,
    );
    return null;
  }
}

const payaiFacilitatorClient = buildPayAIFacilitatorClient();

/** True when the PayAI (Solana) facilitator client was constructed. */
export const isPayAISolanaEnabled = payaiFacilitatorClient !== null;

/**
 * Facilitator client array. CDP first so Base (eip155:8453) keeps routing to
 * CDP exactly as before; PayAI is appended for solana:*. The SDK's
 * x402ResourceServer.initialize() calls getSupported() on each and builds a
 * version→network→scheme→client map (earlier clients win on conflicts), so
 * each network is verified/settled by its own facilitator automatically.
 *
 * If PayAI couldn't be built, the array is just [CDP] — byte-identical to the
 * previous single-facilitator behaviour (Base-only real verification).
 */
const facilitatorClients = payaiFacilitatorClient
  ? [cdpFacilitatorClient, payaiFacilitatorClient]
  : [cdpFacilitatorClient];

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
 * Build a v2 RouteConfig that advertises ONLY the Solana USDC payment option.
 *
 * Same scheme/network/payTo/extra as the Solana leg of `buildRouteConfig` —
 * the Solana accept is byte-identical; we just omit the Base (EVM) leg. Used
 * by the handful of endpoints (/api/ipo, /api/holders, /api/liquidity) that
 * should be settled on Solana only, so AA cannot pick the Base accept. All
 * other paid endpoints keep the dual-leg `buildRouteConfig`.
 */
export function buildSolanaOnlyRouteConfig(
  price: string,
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

// ---------------------------------------------------------------------------
// Self-built Solana 402 challenge (facilitator-independent, v1 + v2 dual leg)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS. The stock `withX402` builds its `accepts[]` from the
// facilitator's `getSupported()`. When PayAI added v2 Solana kinds, that map
// started resolving Solana to the v2 shape (`amount`, CAIP-2 network, body
// `x402Version:2`). Our AA client registered the *v1* Solana scheme, whose
// payload reads `maxAmountRequired` and matches on the bare `"solana"` network
// alias — so the auto-upgraded v2 challenge stopped matching and settlement
// broke. We therefore build the Solana 402 body ourselves and pin it to v1,
// while ALSO co-listing a forward-looking v2 leg for future v2-native clients.
//
// Every field below is grounded in the installed package source (2.13.0), not
// guessed:
//   • v1 field name `maxAmountRequired`  → @x402/svm/v1 ExactSvmSchemeV1
//       (`BigInt(selectedV1.maxAmountRequired)`) + @x402/core
//       PaymentRequirementsV1Schema.
//   • v2 field name `amount`             → @x402/core PaymentRequirementsV2Schema
//       + @x402/svm exact/client (`BigInt(paymentRequirements.amount)`).
//   • v1 network alias `"solana"`        → @x402/svm/v1 V1_TO_V2_NETWORK_MAP
//       ({ solana: "solana:5eykt4…" }); normalizeNetwork() maps it to mainnet.
//   • v2 network (CAIP-2)                → PaymentRequirementsV2Schema requires
//       a ":"-bearing id; SOLANA_NETWORK is the mainnet CAIP-2.
//   • `extra.feePayer`                   → required by BOTH svm client schemes
//       for the sponsored-transfer flow.
//
// PaymentRequirementsV1Schema is a plain `z.object` (unknown keys are stripped,
// not rejected), so carrying `amount` on the v1 leg — and the full v1 field set
// on the v2 leg — is safe: each leg validates under both schemas, and each svm
// client reads whichever amount field it knows.

/** x402 protocol version pinned on the self-built Solana challenge body. */
export const X402_VERSION = 1 as const;

/** Bare v1 network alias for Solana mainnet (svm/v1 V1_TO_V2_NETWORK_MAP). */
export const SOLANA_SCHEME_NETWORK = "solana" as const;

/** CAIP-2 Solana mainnet id, re-exported for the v2 leg. */
export const SOLANA_CAIP2_NETWORK: string = SOLANA_NETWORK;

/** Receive address, re-read at request time (env is fixed per deployment). */
function solanaPayToRuntime(): string {
  return (
    process.env.SOLANA_RECEIVE_ADDRESS ??
    process.env.WALLET_ADDRESS_SOLANA ??
    DEFAULT_SOLANA_PAY_TO
  );
}

// ---------------------------------------------------------------------------
// Dynamic Solana feePayer (freshness-only facilitator dependency)
// ---------------------------------------------------------------------------
//
// feePayer is the facilitator's wallet that sponsors the Solana transfer fee.
// It ROTATES intra-day — observed D6ZhtNQ5nT… → BFK9TLC3… → 2wKupLR9q6…
// on 2026-07-09. A hardcoded / env-pinned value therefore goes stale the moment
// PayAI rotates: a client that partial-signs a tx against a now-retired feePayer
// produces a transaction PayAI can no longer complete, so settlement silently
// breaks. We therefore resolve it LIVE at 402-build time, cache it briefly, and
// fall back to env / last-known-good only when the fetch fails — the 402 body
// is ALWAYS returned.
//
// This does NOT reintroduce the getSupported()-drives-accepts coupling that
// caused the v1→v2 regression: the leg *skeleton* (scheme / network / asset /
// payTo / amount) stays static and self-built. Only this single
// freshness-critical field is sourced from the facilitator, and a failure
// degrades to fallback rather than an empty 402.

// Last feePayer observed on 2026-07-09; seeds the env fallback so a fresh
// deploy is never blank even before the first successful getSupported().
const DEFAULT_SOLANA_FEE_PAYER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";

// Short TTL: long enough to avoid hammering the facilitator per request, short
// enough to pick up a rotation within minutes.
const FEE_PAYER_TTL_MS = 3 * 60 * 1000;
let feePayerCache: { value: string; expires: number } | null = null;

/** env / hardcoded last-known-good feePayer. Never empty. */
export function solanaFeePayerFallback(): string {
  return (
    process.env.X402_SOLANA_FEE_PAYER ||
    process.env.PAYAI_FEE_PAYER ||
    DEFAULT_SOLANA_FEE_PAYER
  );
}

/**
 * Pull the current Solana feePayer from PayAI's `getSupported()` (the
 * `/supported` endpoint) — the same `extra.feePayer` the svm server injects in
 * the stock path. Returns null on any network/auth/shape failure.
 */
async function fetchSolanaFeePayer(): Promise<string | null> {
  if (!payaiFacilitatorClient) return null;
  try {
    const supported = await payaiFacilitatorClient.getSupported();
    for (const kind of supported?.kinds ?? []) {
      const net = typeof kind?.network === "string" ? kind.network : "";
      const fp = kind?.extra?.feePayer;
      if (net.startsWith("solana") && typeof fp === "string" && fp) {
        return fp;
      }
    }
  } catch {
    // Facilitator unreachable / rate-limited / shape drift — fall back.
  }
  return null;
}

/**
 * Resolve the Solana feePayer for a 402 challenge: fresh from PayAI when
 * possible (short-TTL cached), else the last good cached value, else the env /
 * hardcoded fallback. Always resolves — a 402 is never blocked on this.
 */
export async function getSolanaFeePayer(): Promise<string> {
  const now = Date.now();
  if (feePayerCache && feePayerCache.expires > now) {
    return feePayerCache.value;
  }
  const fresh = await fetchSolanaFeePayer();
  if (fresh) {
    feePayerCache = { value: fresh, expires: now + FEE_PAYER_TTL_MS };
    return fresh;
  }
  // Stale-but-known beats the static fallback; static fallback is the floor.
  if (feePayerCache) return feePayerCache.value;
  return solanaFeePayerFallback();
}

/** Convert a `$0.01`-style price to an atomic USDC (6-decimal) string. */
function priceToAtomicUsdc(price: string): string {
  const usd = parseFloat(price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(usd)) {
    throw new Error(`Invalid Solana price: ${price}`);
  }
  return Math.round(usd * 1_000_000).toString();
}

/**
 * A single Solana accept leg. `network` is `string` (not the narrow `"solana"`
 * literal) so the same shape carries both the v1 alias and the v2 CAIP-2 id.
 */
export interface SolanaAccept {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  amount?: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: Record<string, unknown> | null;
}

/**
 * Build the two-leg `accepts[]` for a self-built Solana 402 body: the v1 leg
 * first (AA's live settlement path), the v2 leg second (forward-looking). Both
 * legs price/pay/asset-match; they differ only in `network` and which amount
 * field the client reads.
 *
 * `feePayer` is passed in (resolved by the caller via `getSolanaFeePayer()`, so
 * it tracks PayAI's intra-day rotation); it defaults to the env/last-known-good
 * fallback so the builder alone still produces a complete, non-empty leg.
 */
export function buildSolanaAcceptsV1(
  resourcePath: string,
  price: string,
  description: string,
  feePayer: string = solanaFeePayerFallback(),
): SolanaAccept[] {
  const atomic = priceToAtomicUsdc(price);
  const resource = resourceUrl(resourcePath);
  const payTo = solanaPayToRuntime();
  const extra: Record<string, unknown> = { feePayer, resource };
  const common = {
    scheme: "exact" as const,
    maxAmountRequired: atomic,
    resource,
    description,
    mimeType: "application/json" as const,
    payTo,
    maxTimeoutSeconds: 300,
    asset: ASSET_SOLANA_USDC,
    extra,
  };
  return [
    // v1 leg (first): bare "solana" alias, maxAmountRequired — AA's lifeline.
    { ...common, network: SOLANA_SCHEME_NETWORK },
    // v2 leg (second): CAIP-2 network, adds `amount` for v2-native clients.
    { ...common, network: SOLANA_CAIP2_NETWORK, amount: atomic },
  ];
}
