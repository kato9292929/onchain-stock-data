import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_MODEL,
  Depth,
  SYSTEM_PROMPT,
  userPromptFor,
  validateAnalystOutput,
  AnalystOutput,
} from "./templates";
import { AggregatedTickerData, currentPriceUsd } from "./data-aggregator";
import { SecFiling } from "./sec-edgar";

export interface GenerateInput {
  ticker: string;
  depth: Depth;
  aggregated: AggregatedTickerData;
  sec?: SecFiling;
  comparables?: unknown;
}

export interface GenerateError {
  kind: "missing_api_key" | "claude_error" | "invalid_output" | "timeout";
  message: string;
  raw?: string;
}

const MAX_TOKENS: Record<Depth, number> = {
  quick: 2_500,
  standard: 4_500,
  deep: 8_000,
};

const TIMEOUT_MS: Record<Depth, number> = {
  quick: 60_000,
  standard: 180_000,
  deep: 480_000,
};

export async function generateAnalystReport(
  input: GenerateInput,
): Promise<{ ok: true; report: AnalystOutput } | { ok: false; err: GenerateError }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      err: {
        kind: "missing_api_key",
        message:
          "ANTHROPIC_API_KEY is not set. Configure it in the runtime environment (Vercel / .env.local).",
      },
    };
  }

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS[input.depth] });

  const promptPayload = {
    aggregated: input.aggregated,
    sec_filings: input.sec ?? null,
    comparables: input.comparables ?? null,
    depth_hint: input.depth,
  };

  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create({
      model: CLAUDE_MODEL[input.depth],
      max_tokens: MAX_TOKENS[input.depth],
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userPromptFor({
            ticker: input.ticker,
            depth: input.depth,
            aggregated: promptPayload,
          }),
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = msg.toLowerCase().includes("timeout") ? "timeout" : "claude_error";
    return { ok: false, err: { kind, message: msg } };
  }

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const jsonText = stripCodeFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return {
      ok: false,
      err: {
        kind: "invalid_output",
        message: `Claude returned non-JSON: ${(e as Error).message}`,
        raw: text.slice(0, 2000),
      },
    };
  }

  const validation = validateAnalystOutput(
    parsed,
    currentPriceUsd(input.aggregated),
  );
  if (!validation.ok) {
    return {
      ok: false,
      err: {
        kind: "invalid_output",
        message: validation.error,
        raw: jsonText.slice(0, 2000),
      },
    };
  }

  return { ok: true, report: validation.value };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/, "").trim();
  }
  return trimmed;
}
