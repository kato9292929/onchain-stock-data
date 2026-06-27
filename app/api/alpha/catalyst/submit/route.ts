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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): NextResponse {
  return new NextResponse(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/alpha/catalyst/submit — Phase A external catalyst intake.
 * CORS-open, force-dynamic. Per-IP daily rate limit. Duplicate (ticker +
 * description + target_date) returns the existing record instead of creating.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    console.warn(`[catalyst/submit] rate limited ip=${ip} count=${rl.current}`);
    return json(429, {
      error: "rate_limited",
      message: `daily submission limit of ${rl.limit} reached`,
    });
  }

  let body: SubmitInput;
  try {
    body = (await req.json()) as SubmitInput;
  } catch {
    return json(400, { error: "invalid_json", message: "request body is not valid JSON" });
  }

  const validation = validateSubmission(body);
  if (!validation.ok) {
    return json(400, {
      error: "validation_error",
      field: validation.field,
      message: validation.message,
    });
  }

  try {
    const list = await readExternalCatalysts();

    const dup = findDuplicate(list, validation.value);
    if (dup) {
      // Idempotent: return the existing catalyst, do not create a new one.
      return json(201, {
        catalyst_id: dup.catalyst_id,
        status: dup.status,
        estimated_eval_date: estimatedEvalDate(dup.target_date),
        score_lookup_url: scoreLookupUrl(dup.catalyst_id),
        duplicate: true,
      });
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

    return json(201, {
      catalyst_id: catalyst.catalyst_id,
      status: catalyst.status,
      estimated_eval_date: estimatedEvalDate(catalyst.target_date),
      score_lookup_url: scoreLookupUrl(catalyst.catalyst_id),
    });
  } catch (e) {
    console.error("[catalyst/submit] unexpected error:", e);
    return json(500, { error: "internal_error", message: "failed to record catalyst" });
  }
}
