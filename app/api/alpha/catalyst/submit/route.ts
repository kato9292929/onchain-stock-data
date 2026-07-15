import { NextRequest, NextResponse } from "next/server";
import {
  validateSubmission,
  findDuplicate,
  buildCatalyst,
  estimatedEvalDate,
  scoreLookupUrl,
  readExternalCatalysts,
  writeExternalCatalysts,
  type SubmitInput,
} from "@/lib/external-catalysts";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { upstashConfigured, putCatalyst } from "@/lib/catalyst-upstash";
import { corsPreflight, withPaywall } from "@/lib/x402-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/alpha/catalyst/submit — Phase A external catalyst intake.
 * Paid x402 endpoint (Base + Solana USDC); internal callers bypass with
 * `X-Internal-Key`. Non-2xx results (rate-limit 429 / validation 400) cancel
 * x402 settlement, so a rejected submission is not charged; a created record
 * (201) settles. Per-IP daily rate limit still applies. Duplicate (ticker +
 * description + target_date) returns the existing record instead of creating.
 */
const handler = async (req: NextRequest): Promise<NextResponse> => {
  const ip = clientIp(req.headers);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    console.warn(`[catalyst/submit] rate limited ip=${ip} count=${rl.current}`);
    return NextResponse.json(
      { error: "rate_limited", message: `daily submission limit of ${rl.limit} reached` },
      { status: 429 },
    );
  }

  let body: SubmitInput;
  try {
    body = (await req.json()) as SubmitInput;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "request body is not valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateSubmission(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "validation_error", field: validation.field, message: validation.message },
      { status: 400 },
    );
  }

  try {
    const list = await readExternalCatalysts();

    const dup = findDuplicate(list, validation.value);
    if (dup) {
      // Idempotent: return the existing catalyst, do not create a new one.
      return NextResponse.json(
        {
          catalyst_id: dup.catalyst_id,
          status: dup.status,
          estimated_eval_date: estimatedEvalDate(dup.target_date),
          score_lookup_url: scoreLookupUrl(dup.catalyst_id),
          duplicate: true,
        },
        { status: 201 },
      );
    }

    const catalyst = buildCatalyst(validation.value);

    // JP is persisted in Upstash (the durable, cross-instance store); the file
    // write below is only a local/dev fallback. US behaviour is unchanged.
    if (catalyst.market === "JP" && upstashConfigured()) {
      try {
        await putCatalyst(catalyst);
      } catch (e) {
        console.error(`[catalyst/submit] upstash put failed: ${e}`);
      }
    }

    list.push(catalyst);
    const write = await writeExternalCatalysts(list);
    if (!write.persisted) {
      // FS is read-only on Vercel; log but still return the created record so
      // the submitter has the id. The durable store is Upstash (JP) / GH commit.
      console.error(
        `[catalyst/submit] could not persist (read-only FS?): ${write.reason}`,
      );
    }

    return NextResponse.json(
      {
        catalyst_id: catalyst.catalyst_id,
        status: catalyst.status,
        estimated_eval_date: estimatedEvalDate(catalyst.target_date),
        score_lookup_url: scoreLookupUrl(catalyst.catalyst_id),
      },
      { status: 201 },
    );
  } catch (e) {
    console.error("[catalyst/submit] unexpected error:", e);
    return NextResponse.json(
      { error: "internal_error", message: "failed to record catalyst" },
      { status: 500 },
    );
  }
};

export const POST = withPaywall(handler, {
  price: "$0.01",
  description: "Submit an external catalyst for Claude verdict scoring.",
  resourcePath: "/api/alpha/catalyst/submit",
});

export const OPTIONS = () => corsPreflight();
